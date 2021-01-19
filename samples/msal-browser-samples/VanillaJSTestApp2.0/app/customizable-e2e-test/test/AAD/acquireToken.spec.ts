import puppeteer from "puppeteer";
import { Screenshot, createFolder, setupCredentials } from "../../../../../../e2eTestUtils/TestUtils";
import { BrowserCacheUtils } from "../../../../../../e2eTestUtils/BrowserCacheTestUtils";
import { LabApiQueryParams } from "../../../../../../e2eTestUtils/LabApiQueryParams";
import { AzureEnvironments, AppTypes } from "../../../../../../e2eTestUtils/Constants";
import { LabClient } from "../../../../../../e2eTestUtils/LabClient";
import { msalConfig as aadMsalConfig, request as aadTokenRequest } from "../../authConfigs/aadAuthConfig.json";
import { clickLoginPopup, enterCredentials, waitForReturnToApp, verifyTokenStore } from "../testUtils";
import fs from "fs";

const SCREENSHOT_BASE_FOLDER_NAME = `${__dirname}/screenshots/acquireToken`;
// @ts-ignore
const port = global.__PORT__;
const SAMPLE_HOME_URL = `http://localhost:${port}/`;

describe("acquireToken Tests", () => {
    let screenshot: Screenshot;
    let context: puppeteer.BrowserContext;
    let page: puppeteer.Page;
    let BrowserCache: BrowserCacheUtils;
    let username: string;
    let accountPwd: string;

    jest.setTimeout(15000);
    
    beforeAll(async () => {
        // @ts-ignore
        const browser = await global.__BROWSER__;
        createFolder(SCREENSHOT_BASE_FOLDER_NAME);

        const labApiParams: LabApiQueryParams = {
            azureEnvironment: AzureEnvironments.PPE,
            appType: AppTypes.CLOUD
        };

        const labClient = new LabClient();
        const envResponse = await labClient.getVarsByCloudEnvironment(labApiParams);

        [username, accountPwd] = await setupCredentials(envResponse[0], labClient);

        fs.writeFileSync("./app/customizable-e2e-test/testConfig.json", JSON.stringify({msalConfig: aadMsalConfig, request: aadTokenRequest}));

        context = await browser.createIncognitoBrowserContext();
        page = await context.newPage();
        BrowserCache = new BrowserCacheUtils(page, aadMsalConfig.cache.cacheLocation);
        await page.goto(SAMPLE_HOME_URL);

        screenshot = new Screenshot(`${SCREENSHOT_BASE_FOLDER_NAME}`);
        const [popupPage, popupWindowClosed] = await clickLoginPopup(screenshot, page);
        await enterCredentials(popupPage, screenshot, username, accountPwd);
        await waitForReturnToApp(screenshot, page, popupPage, popupWindowClosed);
    });

    afterAll(async () => {
        await context.close();
    });

    beforeEach(async () => {
        await page.reload();
        await page.waitForSelector("#WelcomeMessage");
    });

    it("acquireTokenRedirect", async () => {
        await page.waitForSelector("#acquireTokenRedirect");
        
        // Remove access_tokens from cache so we can verify acquisition
        const tokenStore = await BrowserCache.getTokens();
        await BrowserCache.removeTokens(tokenStore.refreshTokens);
        await BrowserCache.removeTokens(tokenStore.accessTokens);
        await page.click("#acquireTokenRedirect");
        await page.waitForSelector("#scopes-acquired");
        await screenshot.takeScreenshot(page, "acquireTokenRedirectGotTokens");

        // Verify browser cache contains Account, idToken, AccessToken and RefreshToken
        await verifyTokenStore(BrowserCache, aadTokenRequest.scopes);
    });

    it("acquireTokenPopup", async () => {
        await page.waitForSelector("#acquireTokenPopup");

        // Remove access_tokens from cache so we can verify acquisition
        const tokenStore = await BrowserCache.getTokens();
        await BrowserCache.removeTokens(tokenStore.refreshTokens);
        await BrowserCache.removeTokens(tokenStore.accessTokens);
        await page.click("#acquireTokenPopup");
        await page.waitForSelector("#scopes-acquired");
        await screenshot.takeScreenshot(page, "acquireTokenPopupGotTokens");

        // Verify browser cache contains Account, idToken, AccessToken and RefreshToken
        await verifyTokenStore(BrowserCache, aadTokenRequest.scopes);
    });

    it("acquireTokenSilent from Cache", async () => {
        await page.waitForSelector("#acquireTokenSilent");
        await page.click("#acquireTokenSilent");
        await page.waitForSelector("#scopes-acquired");
        await screenshot.takeScreenshot(page, "acquireTokenSilent-fromCache-GotTokens");

        const telemetryCacheEntry = await BrowserCache.getTelemetryCacheEntry(aadMsalConfig.auth.clientId);
        expect(telemetryCacheEntry).not.toBe(null);
        expect(telemetryCacheEntry["cacheHits"]).toBe(1);
        // Remove Telemetry Cache entry for next test
        await BrowserCache.removeTokens([BrowserCacheUtils.getTelemetryKey(aadMsalConfig.auth.clientId)]);

        // Verify browser cache contains Account, idToken, AccessToken and RefreshToken
        await verifyTokenStore(BrowserCache, aadTokenRequest.scopes);
    });

    it("acquireTokenSilent via RefreshToken", async () => {
        await page.waitForSelector("#acquireTokenSilent");

        // Remove access_tokens from cache so we can verify acquisition
        const tokenStore = await BrowserCache.getTokens();
        await BrowserCache.removeTokens(tokenStore.accessTokens);

        await page.click("#acquireTokenSilent");
        await page.waitForSelector("#scopes-acquired");
        await screenshot.takeScreenshot(page, "acquireTokenSilent-viaRefresh-GotTokens");

        // Verify browser cache contains Account, idToken, AccessToken and RefreshToken
        await verifyTokenStore(BrowserCache, aadTokenRequest.scopes);
    });
});