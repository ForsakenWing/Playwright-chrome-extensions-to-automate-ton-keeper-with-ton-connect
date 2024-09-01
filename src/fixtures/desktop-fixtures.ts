import { AppFactory } from '../pages/desktop/app';
import { test as base } from './fixtures';

export const test = base.extend<{
    app: AppFactory;
}>({
    app: async ({ page }, use) => {
        const app = new AppFactory(page);
        await use(app);
    },
});
