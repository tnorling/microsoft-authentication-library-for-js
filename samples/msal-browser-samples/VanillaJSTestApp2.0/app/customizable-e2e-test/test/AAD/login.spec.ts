import puppeteer from "puppeteer";
import { Screenshot, createFolder, setupCredentials } from "../../../../../../e2eTestUtils/TestUtils";
import { BrowserCacheUtils } from "../../../../../../e2eTestUtils/BrowserCacheTestUtils";
import { LabApiQueryParams } from "../../../../../../e2eTestUtils/LabApiQueryParams";
import { AzureEnvironments, AppTypes } from "../../../../../../e2eTestUtils/Constants";
import { LabClient } from "../../../../../../e2eTestUtils/LabClient";
import { msalConfig as aadMsalConfig, request as aadTokenRequest } from "../../authConfigs/aadAuthConfig.json";
import { clickLoginPopup, clickLoginRedirect, enterCredentials, waitForReturnToApp, verifyTokenStore } from "../testUtils";
import fs from "fs";
import { RedirectRequest } from "@azure/msal-browser";

const SCREENSHOT_BASE_FOLDER_NAME = `${__dirname}/screenshots/login`;
// @ts-ignore
const port = global.__PORT__;
const SAMPLE_HOME_URL = `http://localhost:${port}/`;

describe("login Tests", () => {
    let browser: puppeteer.Browser;
    let page: puppeteer.Page;
    let BrowserCache: BrowserCacheUtils;
    let username: string;
    let accountPwd: string;

    beforeAll(async () => {
        createFolder(SCREENSHOT_BASE_FOLDER_NAME);
        // @ts-ignore
        browser = await global.__BROWSER__;

        const labApiParams: LabApiQueryParams = {
            azureEnvironment: AzureEnvironments.PPE,
            appType: AppTypes.CLOUD
        };

        const labClient = new LabClient();
        const envResponse = await labClient.getVarsByCloudEnvironment(labApiParams);

        [username, accountPwd] = await setupCredentials(envResponse[0], labClient);

        fs.writeFileSync("./app/customizable-e2e-test/testConfig.json", JSON.stringify({msalConfig: aadMsalConfig, request: aadTokenRequest}));
    });

    beforeEach(async () => {
        const context = await browser.createIncognitoBrowserContext();
        page = await context.newPage();
        BrowserCache = new BrowserCacheUtils(page, aadMsalConfig.cache.cacheLocation);
        await page.goto(SAMPLE_HOME_URL);
    });

    afterEach(async () => {
        await page.evaluate(() =>  Object.assign({}, window.sessionStorage.clear()));
        await page.evaluate(() =>  Object.assign({}, window.localStorage.clear()));
        await page.close();
    });

    it("Performs loginRedirect", async () => {
        const testName = "redirectBaseCase";
        const screenshot = new Screenshot(`${SCREENSHOT_BASE_FOLDER_NAME}/${testName}`);

        await clickLoginRedirect(screenshot, page);
        await enterCredentials(page, screenshot, username, accountPwd);
        await waitForReturnToApp(screenshot, page);
        // Verify browser cache contains Account, idToken, AccessToken and RefreshToken
        await verifyTokenStore(BrowserCache, aadTokenRequest.scopes);
    });

    it("Performs loginRedirect from url with empty query string", async () => {
        await page.goto(SAMPLE_HOME_URL + "?");
        const testName = "redirectEmptyQueryString";
        const screenshot = new Screenshot(`${SCREENSHOT_BASE_FOLDER_NAME}/${testName}`);

        await clickLoginRedirect(screenshot, page);
        await enterCredentials(page, screenshot, username, accountPwd);
        await waitForReturnToApp(screenshot, page);
        // Verify browser cache contains Account, idToken, AccessToken and RefreshToken
        await verifyTokenStore(BrowserCache, aadTokenRequest.scopes);
        expect(page.url()).toBe(SAMPLE_HOME_URL);
    });

    it("Performs loginRedirect from url with test query string", async () => {
        const testUrl = SAMPLE_HOME_URL + "?test";
        await page.goto(testUrl);
        const testName = "redirectEmptyQueryString";
        const screenshot = new Screenshot(`${SCREENSHOT_BASE_FOLDER_NAME}/${testName}`);

        await clickLoginRedirect(screenshot, page);
        await enterCredentials(page, screenshot, username, accountPwd);
        await waitForReturnToApp(screenshot, page);
        // Verify browser cache contains Account, idToken, AccessToken and RefreshToken
        await verifyTokenStore(BrowserCache, aadTokenRequest.scopes);
        expect(page.url()).toBe(testUrl);
    });

    it("Performs loginRedirect with relative redirectUri", async () => {
        const relativeRedirectUriRequest: RedirectRequest = {
            ...aadTokenRequest,
            redirectUri: "/"
        }
        fs.writeFileSync("./app/customizable-e2e-test/testConfig.json", JSON.stringify({msalConfig: aadMsalConfig, request: relativeRedirectUriRequest}));
        page.reload();

        const testName = "redirectBaseCase";
        const screenshot = new Screenshot(`${SCREENSHOT_BASE_FOLDER_NAME}/${testName}`);

        await clickLoginRedirect(screenshot, page);
        await enterCredentials(page, screenshot, username, accountPwd);
        await waitForReturnToApp(screenshot, page);
        // Verify browser cache contains Account, idToken, AccessToken and RefreshToken
        await verifyTokenStore(BrowserCache, aadTokenRequest.scopes);
    });

    it("Performs loginRedirect with relative redirectStartPage", async () => {
        const relativeRedirectUriRequest: RedirectRequest = {
            ...aadTokenRequest,
            redirectStartPage: "/"
        }
        fs.writeFileSync("./app/customizable-e2e-test/testConfig.json", JSON.stringify({msalConfig: aadMsalConfig, request: relativeRedirectUriRequest}));
        page.reload();

        const testName = "redirectBaseCase";
        const screenshot = new Screenshot(`${SCREENSHOT_BASE_FOLDER_NAME}/${testName}`);

        await clickLoginRedirect(screenshot, page);
        await enterCredentials(page, screenshot, username, accountPwd);
        await waitForReturnToApp(screenshot, page);
        // Verify browser cache contains Account, idToken, AccessToken and RefreshToken
        await verifyTokenStore(BrowserCache, aadTokenRequest.scopes);
    });
    
    it("Performs loginPopup", async () => {
        const testName = "popupBaseCase";
        const screenshot = new Screenshot(`${SCREENSHOT_BASE_FOLDER_NAME}/${testName}`);

        const [popupPage, popupWindowClosed] = await clickLoginPopup(screenshot, page);
        await enterCredentials(popupPage, screenshot, username, accountPwd);
        await waitForReturnToApp(screenshot, page, popupPage, popupWindowClosed);

        // Verify browser cache contains Account, idToken, AccessToken and RefreshToken
        await verifyTokenStore(BrowserCache, aadTokenRequest.scopes);
    });
});