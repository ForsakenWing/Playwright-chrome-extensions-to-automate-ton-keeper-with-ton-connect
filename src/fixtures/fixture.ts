// fixtures.ts
import { test as base, expect, BrowserContext, BrowserType, Page, WorkerInfo } from '@playwright/test';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

function firefoxContextOptions({ pathToExtension }: { pathToExtension: string }) {
    return {
        firefoxUserPrefs: {
            // Set preferences to allow installation of unsigned extensions, if needed
            'xpinstall.signatures.required': false,
            'devtools.debugger.remote-enabled': true,
            'extensions.autoDisableScopes': 0,
            'extensions.logging.enabled': true,
            'devtools.chrome.enabled': true,
            'extensions.enabledAddons': 'wallet@tonkeeper.com', // Specify your extension ID
            // Add any other preferences you need to control
        },
        args: ['-install-extension', pathToExtension + '/tonkeeper.xpi'],
    };
}

function chromeContextOptions({ pathToExtension }: { pathToExtension: string }) {
    return {
        args: ['--disable-extensions-except=' + pathToExtension, '--load-extension=' + pathToExtension, '--no-sandbox'],
    };
}

const getBrowserContextOptions = (browserName: string) => {
    switch (browserName) {
        case 'firefox':
            return firefoxContextOptions;
        case 'chromium':
        case 'chrome':
        case 'edge':
            return chromeContextOptions;
        default:
            throw new Error('Unsupported browser: ' + browserName);
    }
};

export const test = base.extend<{
    page: Page;
}>({
    page: [
        async ({ playwright, browserName, viewport, isMobile, userAgent }, use, workerInfo) => {
            const browser = playwright[browserName];
            const context = await launchContextAndInstallExtension(
                browser,
                browserName,
                workerInfo,
                isMobile,
                userAgent,
            );
            const page = context.pages()[0];
            await navigateToPageAndClickConnectWallet(page);
            const extensionPage = await setUpExtensionAndSwitchToPage(page, context);
            await connectWallet(page, extensionPage);
            const reloadThePageButton = page.getByRole('button', { name: 'reload the page' });
            await page.addLocatorHandler(reloadThePageButton, async () => {
                await reloadThePageButton.click();
            });
            await expect(page).toHaveURL(/.*trade\/TON_USDT/);
            await expect(page.getByText('Connect wallet').first()).not.toBeVisible();
            await expect(page.getByText('Wallet')).toBeVisible();
            await page.setViewportSize(viewport);
            await use(page);
            await page.close();
        },
        { timeout: 90000, scope: 'test' },
    ],
});

async function launchContextAndInstallExtension(
    browser: BrowserType,
    browserName: string,
    workerInfo: WorkerInfo,
    isMobile: boolean,
    userAgent: string,
): Promise<BrowserContext> {
    const userDataDir = path.resolve(
        __dirname,
        `${process.cwd()}/user-data/${workerInfo.project.name}/${workerInfo.workerIndex}/${Date.now()}`,
    );
    // Launch the browser with the extension loaded using a persistent context
    const pathToTonKeeper = `${process.cwd()}/tonKeeper/${browserName}`;
    const contextOptions = getBrowserContextOptions(browserName)({ pathToExtension: pathToTonKeeper });
    const context = await browser.launchPersistentContext(userDataDir, {
        ...contextOptions,
        isMobile: false,
        viewport: { width: 1280, height: 720 },
        userAgent: isMobile
            ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
            : userAgent,
    });
    return context;
}

async function navigateToPageAndClickConnectWallet(page: Page) {
    // Perform authentication or other setup tasks
    // Adjust this URL if needed
    await page.goto('https://app.storm.tg/');
    // Trying to add support for mobile devices, but it seems like extensions are not applicable for them and we would need a work-around
    const continueInBrowserButton = page.getByRole('button', { name: 'Continue' });
    await page.addLocatorHandler(continueInBrowserButton, async () => {
        await continueInBrowserButton.click();
    });
    await page.getByRole('button', { name: 'connect wallet' }).first().click();
}

async function setUpExtensionAndSwitchToPage(
    page: Page,
    context: BrowserContext,
    extensionName: string = 'tonkeeper',
): Promise<Page> {
    const newPage = await clickBrowserExtension(page, context, extensionName);
    await clickGetStartedButtonOnExtensionPage(newPage);
    return await clickExistingWalletButtonOnExtensionPage(newPage, context);
}
async function clickBrowserExtension(page: Page, context: BrowserContext, extensionName: string): Promise<Page> {
    await page.getByRole('button', { name: extensionName }).click();
    const [, newPage] = await Promise.all([
        page.getByRole('button', { name: 'Browser Extension' }).click(),
        getNewPage(context),
    ]);
    return newPage;
}

async function getNewPage(context: BrowserContext): Promise<Page> {
    const pagePromise = context.waitForEvent('page');
    const newPage = await pagePromise;
    await newPage.waitForLoadState('load', { timeout: 5000 });
    return newPage;
}

async function clickGetStartedButtonOnExtensionPage(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Get started' }).click();
}

async function clickExistingWalletButtonOnExtensionPage(page: Page, context: BrowserContext): Promise<Page> {
    const pagePromise = context.waitForEvent('page');
    const [, extensionPage] = await Promise.all([page.getByText('Existing Wallet').click(), pagePromise]);
    return extensionPage;
}

async function connectWallet(page: Page, extensionPage: Page) {
    const phrasesInputs = extensionPage.locator('input');
    await expect(phrasesInputs).toHaveCount(24);
    const allPhrasedInputs = await phrasesInputs.all();
    const phrases = JSON.parse(process.env.PHRASES);
    for (const [index, input] of allPhrasedInputs.entries()) {
        await input.fill(phrases[index]);
    }
    await extensionPage.click('button');
    await extensionPage.getByRole('button', { name: 'Continue' }).click();
    const passwordLocators = extensionPage.locator('input');
    await expect(passwordLocators).toHaveCount(2);
    const [password, confirmPassword] = await passwordLocators.all();
    await password.fill('12345678');
    await confirmPassword.fill('12345678');
    await Promise.all([
        extensionPage.click('button'),
        expect(extensionPage.getByText('Congratulations!')).toBeVisible(),
    ]);
    const newPagePromise = extensionPage.context().waitForEvent('page');
    await extensionPage.close();
    const [, newExtensionPage] = await Promise.all([
        page.getByRole('button', { name: 'Retry' }).click(),
        newPagePromise,
    ]);
    await newExtensionPage.getByRole('button', { name: 'Connect wallet' }).click();
}
