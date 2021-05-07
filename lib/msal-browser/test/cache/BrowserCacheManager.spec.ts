/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { expect } from "chai";
import sinon from "sinon";
import "mocha";
import { BrowserAuthErrorMessage } from "../../src/error/BrowserAuthError";
import { TEST_CONFIG, TEST_TOKENS, TEST_DATA_CLIENT_INFO, RANDOM_TEST_GUID, TEST_URIS, TEST_STATE_VALUES, DEFAULT_OPENID_CONFIG_RESPONSE } from "../utils/StringConstants";
import { CacheOptions } from "../../src/config/Configuration";
import { Constants, PersistentCacheKeys, CommonAuthorizationCodeRequest as AuthorizationCodeRequest, ProtocolUtils, Logger, LogLevel, AuthenticationScheme, AuthorityMetadataEntity, AccountEntity, Authority, StubbedNetworkModule, CacheManager, IdToken, IdTokenEntity, AccessTokenEntity, RefreshTokenEntity, AppMetadataEntity, ServerTelemetryEntity, ThrottlingEntity, CredentialType } from "@azure/msal-common";
import { BrowserCacheLocation, InteractionType, TemporaryCacheKeys } from "../../src/utils/BrowserConstants";
import { CryptoOps } from "../../src/crypto/CryptoOps";
import { DatabaseStorage } from "../../src/cache/DatabaseStorage";
import { BrowserCacheManager } from "../../src/cache/BrowserCacheManager";
import { BrowserStateObject } from "../../src/utils/BrowserProtocolUtils";

describe("BrowserCacheManager tests", () => {

    let cacheConfig: Required<CacheOptions>;
    let logger: Logger;
    let windowRef: Window & typeof globalThis;
    const browserCrypto = new CryptoOps();
    beforeEach(() => {
        cacheConfig = {
            cacheLocation: BrowserCacheLocation.SessionStorage,
            storeAuthStateInCookie: false,
            secureCookies: false
        };
        logger = new Logger({
            loggerCallback: (level: LogLevel, message: string, containsPii: boolean): void => {
                if (containsPii) {
                    console.log(`Log level: ${level} Message: ${message}`);
                }
            },
            piiLoggingEnabled: true
        });
        windowRef = window;
    });

    afterEach(() => {
        sinon.restore();
        window = windowRef;
        window.sessionStorage.clear();
        window.localStorage.clear();
    });

    describe("Constructor", () => {

        it("Falls back to memory storage if cache location string does not match localStorage or sessionStorage", () => {
            cacheConfig.cacheLocation = "notALocation";
            const cacheManager = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            cacheManager.setItem("key", "value");
            expect(window.localStorage.getItem("key")).to.be.null;
            expect(window.sessionStorage.getItem("key")).to.be.null;
            expect(cacheManager.getItem("key")).to.equal("value");
        });

        it("Falls back to memory storage if storage is not supported", () => {
            // Test sessionStorage not supported
            sinon.stub(window, "sessionStorage").value(null);
            const sessionCache = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            sessionCache.setItem("key", "value");
            expect(sessionCache.getItem("key")).to.equal("value");

            // Test local storage not supported
            sinon.stub(window, "localStorage").value(null);
            cacheConfig.cacheLocation = BrowserCacheLocation.LocalStorage;
            const localCache = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            localCache.setItem("key", "value");
            expect(localCache.getItem("key")).to.equal("value");
        });

        it("Creates a BrowserStorage object that implements the ICacheStorage interface", () => {
            const browserStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            expect(browserStorage.setItem).to.be.not.null;
            expect(browserStorage.getItem).to.be.not.null;
            expect(browserStorage.removeItem).to.be.not.null;
            expect(browserStorage.containsKey).to.be.not.null;
            expect(browserStorage.getKeys).to.be.not.null;
            expect(browserStorage.clear).to.be.not.null;
        });

        it("Migrates cache entries from the old cache format", () => {
            const idTokenKey = `${Constants.CACHE_PREFIX}.${PersistentCacheKeys.ID_TOKEN}`;
            const clientInfoKey = `${Constants.CACHE_PREFIX}.${PersistentCacheKeys.CLIENT_INFO}`;
            const errorKey = `${Constants.CACHE_PREFIX}.${PersistentCacheKeys.ERROR}`;
            const errorDescKey = `${Constants.CACHE_PREFIX}.${PersistentCacheKeys.ERROR_DESC}`;
            const errorKeyVal = "error_code";
            const errorDescVal = "error occurred";
            window.sessionStorage.setItem(idTokenKey, TEST_TOKENS.IDTOKEN_V2);
            window.sessionStorage.setItem(clientInfoKey, TEST_DATA_CLIENT_INFO.TEST_RAW_CLIENT_INFO);
            window.sessionStorage.setItem(errorKey, errorKeyVal);
            window.sessionStorage.setItem(errorDescKey, errorDescVal);

            const browserStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            expect(window.sessionStorage.getItem(idTokenKey)).to.be.eq(TEST_TOKENS.IDTOKEN_V2);
            expect(window.sessionStorage.getItem(clientInfoKey)).to.be.eq(TEST_DATA_CLIENT_INFO.TEST_RAW_CLIENT_INFO);
            expect(window.sessionStorage.getItem(errorKey)).to.be.eq(errorKeyVal);
            expect(window.sessionStorage.getItem(errorDescKey)).to.be.eq(errorDescVal);
            expect(browserStorage.getTemporaryCache(PersistentCacheKeys.ID_TOKEN, true)).to.be.eq(TEST_TOKENS.IDTOKEN_V2);
            expect(browserStorage.getTemporaryCache(PersistentCacheKeys.CLIENT_INFO, true)).to.be.eq(TEST_DATA_CLIENT_INFO.TEST_RAW_CLIENT_INFO);
            expect(browserStorage.getTemporaryCache(PersistentCacheKeys.ERROR, true)).to.be.eq(errorKeyVal);
            expect(browserStorage.getTemporaryCache(PersistentCacheKeys.ERROR_DESC, true)).to.be.eq(errorDescVal);
        });
    });

    describe("Interface functions", () => {

        let browserSessionStorage: BrowserCacheManager;
        let authority: Authority;
        let browserLocalStorage: BrowserCacheManager;
        let cacheVal: string;
        let msalCacheKey: string;
        let msalCacheKey2: string;
        beforeEach(() => {
            browserSessionStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            authority = new Authority(TEST_CONFIG.validAuthority, StubbedNetworkModule, browserSessionStorage, {});
            sinon.stub(Authority.prototype, "getPreferredCache").returns("login.microsoftonline.com");
            cacheConfig.cacheLocation = BrowserCacheLocation.LocalStorage;
            browserLocalStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            cacheVal = "cacheVal";
            msalCacheKey = browserSessionStorage.generateCacheKey("cacheKey");
            msalCacheKey2 = browserSessionStorage.generateCacheKey("cacheKey2");
        });

        afterEach(() => {
            browserSessionStorage.clear();
            browserLocalStorage.clear();
        });

        it("setTemporaryCache", () => {
            browserSessionStorage.setTemporaryCache("cacheKey", cacheVal, true);
            browserLocalStorage.setTemporaryCache("cacheKey2", cacheVal, true);
            expect(window.sessionStorage.getItem(msalCacheKey)).to.be.eq(cacheVal);
            expect(window.sessionStorage.getItem(msalCacheKey2)).to.be.eq(cacheVal);
        });

        it("getTemporaryCache falls back to local storage if not found in session/memory storage", () => {
            const testTempItemKey = "test-temp-item-key";
            const testTempItemValue = "test-temp-item-value";
            window.localStorage.setItem(testTempItemKey, testTempItemValue);
            cacheConfig.cacheLocation = BrowserCacheLocation.LocalStorage;
            browserLocalStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            expect(browserLocalStorage.getTemporaryCache(testTempItemKey)).equals(testTempItemValue);
        })

        it("setItem", () => {
            window.sessionStorage.setItem(msalCacheKey, cacheVal);
            window.localStorage.setItem(msalCacheKey2, cacheVal);
            expect(browserSessionStorage.getItem(msalCacheKey)).to.be.eq(cacheVal);
            expect(browserLocalStorage.getItem(msalCacheKey2)).to.be.eq(cacheVal);
        });

        it("removeItem()", () => {
            browserSessionStorage.setTemporaryCache("cacheKey", cacheVal, true);
            browserLocalStorage.setTemporaryCache("cacheKey", cacheVal, true);
            browserSessionStorage.removeItem(msalCacheKey);
            browserLocalStorage.removeItem(msalCacheKey);
            expect(window.sessionStorage.getItem(msalCacheKey)).to.be.null;
            expect(window.localStorage.getItem(msalCacheKey)).to.be.null;
            expect(browserLocalStorage.getTemporaryCache("cacheKey", true)).to.be.null;
            expect(browserSessionStorage.getTemporaryCache("cacheKey", true)).to.be.null;
        });

        it("containsKey()", () => {
            browserSessionStorage.setTemporaryCache("cacheKey", cacheVal, true);
            browserLocalStorage.setItem(msalCacheKey, cacheVal);
            expect(browserSessionStorage.containsKey(msalCacheKey)).to.be.true;
            expect(browserLocalStorage.containsKey(msalCacheKey)).to.be.true;
        });

        it("getKeys()", () => {
            browserLocalStorage.setItem(msalCacheKey, cacheVal);
            browserLocalStorage.setItem(msalCacheKey2, cacheVal);
            expect(browserLocalStorage.getKeys()).to.be.deep.eq([msalCacheKey, msalCacheKey2]);
        });

        it("clear()", () => {
            browserSessionStorage.setTemporaryCache("cacheKey", cacheVal, true);
            browserLocalStorage.setTemporaryCache("cacheKey", cacheVal, true);
            browserSessionStorage.clear();
            browserLocalStorage.clear();
            expect(browserSessionStorage.getKeys()).to.be.empty;
            expect(browserLocalStorage.getKeys()).to.be.empty;
        });

        describe("Getters and Setters", () => {

            describe("Account", () => {
                it("getAccount returns null if key not in cache", () => {
                    const key = "not-in-cache";
                    expect(browserSessionStorage.getAccount(key)).to.be.null;
                    expect(browserLocalStorage.getAccount(key)).to.be.null;
                });

                it("getAccount returns null if value is not JSON", () => {
                    const key = "testKey";
                    browserLocalStorage.setItem(key, "this is not json");
                    browserSessionStorage.setItem(key, "this is not json");

                    expect(browserSessionStorage.getAccount(key)).to.be.null;
                    expect(browserLocalStorage.getAccount(key)).to.be.null;
                });

                it("getAccount returns null if value is not account entity", () => {
                    const key = "testKey";
                    const partialAccount = {
                        homeAccountId: "home-accountId"
                    };

                    browserLocalStorage.setItem(key, JSON.stringify(partialAccount));
                    browserSessionStorage.setItem(key, JSON.stringify(partialAccount));

                    expect(browserSessionStorage.getAccount(key)).to.be.null;
                    expect(browserLocalStorage.getAccount(key)).to.be.null;
                });

                it("getAccount returns AccountEntity", () => {
                    const testAccount = AccountEntity.createAccount(TEST_DATA_CLIENT_INFO.TEST_RAW_CLIENT_INFO, "homeAccountId", authority, new IdToken(TEST_TOKENS.IDTOKEN_V2, browserCrypto), "oboAssertion", "cloudGraphHost", "msGraphHost");

                    browserLocalStorage.setAccount(testAccount);
                    browserSessionStorage.setAccount(testAccount);

                    expect(browserSessionStorage.getAccount(testAccount.generateAccountKey())).to.deep.eq(testAccount);
                    expect(browserSessionStorage.getAccount(testAccount.generateAccountKey())).to.be.instanceOf(AccountEntity);
                    expect(browserLocalStorage.getAccount(testAccount.generateAccountKey())).to.deep.eq(testAccount);
                    expect(browserLocalStorage.getAccount(testAccount.generateAccountKey())).to.be.instanceOf(AccountEntity);
                });
            });

            describe("IdTokenCredential", () => {
                it("getIdTokenCredential returns null if key not in cache", () => {
                    const key = "not-in-cache";
                    expect(browserSessionStorage.getIdTokenCredential(key)).to.be.null;
                    expect(browserLocalStorage.getIdTokenCredential(key)).to.be.null;
                });

                it("getIdTokenCredential returns null if value is not JSON", () => {
                    const key = "testKey";
                    browserLocalStorage.setItem(key, "this is not json");
                    browserSessionStorage.setItem(key, "this is not json");

                    expect(browserSessionStorage.getIdTokenCredential(key)).to.be.null;
                    expect(browserLocalStorage.getIdTokenCredential(key)).to.be.null;
                });

                it("getIdTokenCredential returns null if value is not idToken entity", () => {
                    const key = "testKey";
                    const partialIdTokenEntity = {
                        homeAccountId: "home-accountId"
                    };

                    browserLocalStorage.setItem(key, JSON.stringify(partialIdTokenEntity));
                    browserSessionStorage.setItem(key, JSON.stringify(partialIdTokenEntity));

                    expect(browserSessionStorage.getIdTokenCredential(key)).to.be.null;
                    expect(browserLocalStorage.getIdTokenCredential(key)).to.be.null;
                });

                it("getIdTokenCredential returns IdTokenEntity", () => {
                    const testIdToken = IdTokenEntity.createIdTokenEntity("homeAccountId", "environment", TEST_TOKENS.IDTOKEN_V2, "client-id", "tenantId", "oboAssertion");

                    browserLocalStorage.setIdTokenCredential(testIdToken);
                    browserSessionStorage.setIdTokenCredential(testIdToken);

                    expect(browserSessionStorage.getIdTokenCredential(testIdToken.generateCredentialKey())).to.deep.eq(testIdToken);
                    expect(browserSessionStorage.getIdTokenCredential(testIdToken.generateCredentialKey())).to.be.instanceOf(IdTokenEntity);
                    expect(browserLocalStorage.getIdTokenCredential(testIdToken.generateCredentialKey())).to.deep.eq(testIdToken);
                    expect(browserLocalStorage.getIdTokenCredential(testIdToken.generateCredentialKey())).to.be.instanceOf(IdTokenEntity);
                });
            });

            describe("AccessTokenCredential", () => {
                it("getAccessTokenCredential returns null if key not in cache", () => {
                    const key = "not-in-cache";
                    expect(browserSessionStorage.getAccessTokenCredential(key)).to.be.null;
                    expect(browserLocalStorage.getAccessTokenCredential(key)).to.be.null;
                });

                it("getAccessTokenCredential returns null if value is not JSON", () => {
                    const key = "testKey";
                    browserLocalStorage.setItem(key, "this is not json");
                    browserSessionStorage.setItem(key, "this is not json");

                    expect(browserSessionStorage.getAccessTokenCredential(key)).to.be.null;
                    expect(browserLocalStorage.getAccessTokenCredential(key)).to.be.null;
                });

                it("getAccessTokenCredential returns null if value is not accessToken entity", () => {
                    const key = "testKey";
                    const partialAccessTokenEntity = {
                        homeAccountId: "home-accountId"
                    };

                    browserLocalStorage.setItem(key, JSON.stringify(partialAccessTokenEntity));
                    browserSessionStorage.setItem(key, JSON.stringify(partialAccessTokenEntity));

                    expect(browserSessionStorage.getAccessTokenCredential(key)).to.be.null;
                    expect(browserLocalStorage.getAccessTokenCredential(key)).to.be.null;
                });

                it("getAccessTokenCredential returns AccessTokenEntity", () => {
                    const testAccessToken = AccessTokenEntity.createAccessTokenEntity("homeAccountId", "environment", TEST_TOKENS.ACCESS_TOKEN, "client-id", "tenantId", "openid", 1000, 1000, browserCrypto, 500, AuthenticationScheme.BEARER, "oboAssertion");

                    browserLocalStorage.setAccessTokenCredential(testAccessToken);
                    browserSessionStorage.setAccessTokenCredential(testAccessToken);

                    expect(browserSessionStorage.getAccessTokenCredential(testAccessToken.generateCredentialKey())).to.deep.eq(testAccessToken);
                    expect(browserSessionStorage.getAccessTokenCredential(testAccessToken.generateCredentialKey())).to.be.instanceOf(AccessTokenEntity);
                    expect(browserLocalStorage.getAccessTokenCredential(testAccessToken.generateCredentialKey())).to.deep.eq(testAccessToken);
                    expect(browserLocalStorage.getAccessTokenCredential(testAccessToken.generateCredentialKey())).to.be.instanceOf(AccessTokenEntity);
                });
                
                it("getAccessTokenCredential returns Bearer access token when authentication scheme is set to Bearer and both a Bearer and pop token are in the cache", () => {
                    const testAccessTokenWithoutAuthScheme = AccessTokenEntity.createAccessTokenEntity("homeAccountId", "environment", TEST_TOKENS.ACCESS_TOKEN, "client-id", "tenantId", "openid", 1000, 1000, browserCrypto, 500, AuthenticationScheme.BEARER, "oboAssertion");
                    const testAccessTokenWithAuthScheme = AccessTokenEntity.createAccessTokenEntity("homeAccountId", "environment", TEST_TOKENS.POP_TOKEN, "client-id", "tenantId", "openid", 1000, 1000, browserCrypto, 500, AuthenticationScheme.POP, "oboAssertion");
                    // Cache bearer token
                    browserLocalStorage.setAccessTokenCredential(testAccessTokenWithoutAuthScheme);
                    browserSessionStorage.setAccessTokenCredential(testAccessTokenWithoutAuthScheme);

                    // Cache pop token
                    browserLocalStorage.setAccessTokenCredential(testAccessTokenWithAuthScheme);
                    browserSessionStorage.setAccessTokenCredential(testAccessTokenWithAuthScheme);

                    expect(browserSessionStorage.getAccessTokenCredential(testAccessTokenWithoutAuthScheme.generateCredentialKey())).to.deep.eq(testAccessTokenWithoutAuthScheme);
                    expect(browserSessionStorage.getAccessTokenCredential(testAccessTokenWithoutAuthScheme.generateCredentialKey()).credentialType).to.eq(CredentialType.ACCESS_TOKEN);
                    expect(browserSessionStorage.getAccessTokenCredential(testAccessTokenWithoutAuthScheme.generateCredentialKey())).to.be.instanceOf(AccessTokenEntity);
                    expect(browserLocalStorage.getAccessTokenCredential(testAccessTokenWithoutAuthScheme.generateCredentialKey())).to.deep.eq(testAccessTokenWithoutAuthScheme);
                    expect(browserLocalStorage.getAccessTokenCredential(testAccessTokenWithoutAuthScheme.generateCredentialKey()).credentialType).to.eq(CredentialType.ACCESS_TOKEN);
                    expect(browserLocalStorage.getAccessTokenCredential(testAccessTokenWithoutAuthScheme.generateCredentialKey())).to.be.instanceOf(AccessTokenEntity);
                });

                it("getAccessTokenCredential returns PoP access token when authentication scheme is set to pop and both a Bearer and pop token are in the cache", () => {
                    const testAccessTokenWithoutAuthScheme = AccessTokenEntity.createAccessTokenEntity("homeAccountId", "environment", TEST_TOKENS.ACCESS_TOKEN, "client-id", "tenantId", "openid", 1000, 1000, browserCrypto, 500, AuthenticationScheme.BEARER, "oboAssertion");
                    const testAccessTokenWithAuthScheme = AccessTokenEntity.createAccessTokenEntity("homeAccountId", "environment", TEST_TOKENS.POP_TOKEN, "client-id", "tenantId", "openid", 1000, 1000, browserCrypto, 500, AuthenticationScheme.POP, "oboAssertion");
                    // Cache bearer token
                    browserLocalStorage.setAccessTokenCredential(testAccessTokenWithoutAuthScheme);
                    browserSessionStorage.setAccessTokenCredential(testAccessTokenWithoutAuthScheme);

                    // Cache pop token
                    browserLocalStorage.setAccessTokenCredential(testAccessTokenWithAuthScheme);
                    browserSessionStorage.setAccessTokenCredential(testAccessTokenWithAuthScheme);

                    expect(browserSessionStorage.getAccessTokenCredential(testAccessTokenWithAuthScheme.generateCredentialKey())).to.deep.eq(testAccessTokenWithAuthScheme);
                    expect(browserSessionStorage.getAccessTokenCredential(testAccessTokenWithAuthScheme.generateCredentialKey()).credentialType).to.eq(CredentialType.ACCESS_TOKEN_WITH_AUTH_SCHEME);
                    expect(browserSessionStorage.getAccessTokenCredential(testAccessTokenWithAuthScheme.generateCredentialKey())).to.be.instanceOf(AccessTokenEntity);
                    expect(browserLocalStorage.getAccessTokenCredential(testAccessTokenWithAuthScheme.generateCredentialKey())).to.deep.eq(testAccessTokenWithAuthScheme);
                    expect(browserLocalStorage.getAccessTokenCredential(testAccessTokenWithAuthScheme.generateCredentialKey()).credentialType).to.eq(CredentialType.ACCESS_TOKEN_WITH_AUTH_SCHEME);
                    expect(browserLocalStorage.getAccessTokenCredential(testAccessTokenWithAuthScheme.generateCredentialKey())).to.be.instanceOf(AccessTokenEntity);
                })
            });

            describe("RefreshTokenCredential", () => {
                it("getRefreshTokenCredential returns null if key not in cache", () => {
                    const key = "not-in-cache";
                    expect(browserSessionStorage.getRefreshTokenCredential(key)).to.be.null;
                    expect(browserLocalStorage.getRefreshTokenCredential(key)).to.be.null;
                });

                it("getRefreshTokenCredential returns null if value is not JSON", () => {
                    const key = "testKey";
                    browserLocalStorage.setItem(key, "this is not json");
                    browserSessionStorage.setItem(key, "this is not json");

                    expect(browserSessionStorage.getRefreshTokenCredential(key)).to.be.null;
                    expect(browserLocalStorage.getRefreshTokenCredential(key)).to.be.null;
                });

                it("getRefreshTokenCredential returns null if value is not refreshToken entity", () => {
                    const key = "testKey";
                    const partialRefreshTokenEntity = {
                        homeAccountId: "home-accountId"
                    };

                    browserLocalStorage.setItem(key, JSON.stringify(partialRefreshTokenEntity));
                    browserSessionStorage.setItem(key, JSON.stringify(partialRefreshTokenEntity));

                    expect(browserSessionStorage.getRefreshTokenCredential(key)).to.be.null;
                    expect(browserLocalStorage.getRefreshTokenCredential(key)).to.be.null;
                });

                it("getRefreshTokenCredential returns RefreshTokenEntity", () => {
                    const testRefreshToken = RefreshTokenEntity.createRefreshTokenEntity("homeAccountId", "environment", TEST_TOKENS.REFRESH_TOKEN, "client-id", "familyId", "oboAssertion");

                    browserLocalStorage.setRefreshTokenCredential(testRefreshToken);
                    browserSessionStorage.setRefreshTokenCredential(testRefreshToken);

                    expect(browserSessionStorage.getRefreshTokenCredential(testRefreshToken.generateCredentialKey())).to.deep.eq(testRefreshToken);
                    expect(browserSessionStorage.getRefreshTokenCredential(testRefreshToken.generateCredentialKey())).to.be.instanceOf(RefreshTokenEntity);
                    expect(browserLocalStorage.getRefreshTokenCredential(testRefreshToken.generateCredentialKey())).to.deep.eq(testRefreshToken);
                    expect(browserLocalStorage.getRefreshTokenCredential(testRefreshToken.generateCredentialKey())).to.be.instanceOf(RefreshTokenEntity);
                });
            });

            describe("AppMetadata", () => {
                it("getAppMetadata returns null if key not in cache", () => {
                    const key = "not-in-cache";
                    expect(browserSessionStorage.getAppMetadata(key)).to.be.null;
                    expect(browserLocalStorage.getAppMetadata(key)).to.be.null;
                });

                it("getAppMetadata returns null if value is not JSON", () => {
                    const key = "testKey";
                    browserLocalStorage.setItem(key, "this is not json");
                    browserSessionStorage.setItem(key, "this is not json");

                    expect(browserSessionStorage.getAppMetadata(key)).to.be.null;
                    expect(browserLocalStorage.getAppMetadata(key)).to.be.null;
                });

                it("getAppMetadata returns null if value is not appMetadata entity", () => {
                    const key = "testKey";
                    const partialAppMetadataEntity = {
                        environment: "environment"
                    };

                    browserLocalStorage.setItem(key, JSON.stringify(partialAppMetadataEntity));
                    browserSessionStorage.setItem(key, JSON.stringify(partialAppMetadataEntity));

                    expect(browserSessionStorage.getAppMetadata(key)).to.be.null;
                    expect(browserLocalStorage.getAppMetadata(key)).to.be.null;
                });

                it("getAppMetadata returns AppMetadataEntity", () => {
                    const testAppMetadata = AppMetadataEntity.createAppMetadataEntity("clientId", "environment", "familyid");

                    browserLocalStorage.setAppMetadata(testAppMetadata);
                    browserSessionStorage.setAppMetadata(testAppMetadata);

                    expect(browserSessionStorage.getAppMetadata(testAppMetadata.generateAppMetadataKey())).to.deep.eq(testAppMetadata);
                    expect(browserSessionStorage.getAppMetadata(testAppMetadata.generateAppMetadataKey())).to.be.instanceOf(AppMetadataEntity);
                    expect(browserLocalStorage.getAppMetadata(testAppMetadata.generateAppMetadataKey())).to.deep.eq(testAppMetadata);
                    expect(browserLocalStorage.getAppMetadata(testAppMetadata.generateAppMetadataKey())).to.be.instanceOf(AppMetadataEntity);
                });
            });

            describe("ServerTelemetry", () => {
                it("getServerTelemetry returns null if key not in cache", () => {
                    const key = "not-in-cache";
                    expect(browserSessionStorage.getServerTelemetry(key)).to.be.null;
                    expect(browserLocalStorage.getServerTelemetry(key)).to.be.null;
                });

                it("getServerTelemetry returns null if value is not JSON", () => {
                    const key = "testKey";
                    browserLocalStorage.setItem(key, "this is not json");
                    browserSessionStorage.setItem(key, "this is not json");

                    expect(browserSessionStorage.getServerTelemetry(key)).to.be.null;
                    expect(browserLocalStorage.getServerTelemetry(key)).to.be.null;
                });

                it("getServerTelemetry returns null if value is not serverTelemetry entity", () => {
                    const key = "testKey";
                    const partialServerTelemetryEntity = {
                        apiId: 0
                    };

                    browserLocalStorage.setItem(key, JSON.stringify(partialServerTelemetryEntity));
                    browserSessionStorage.setItem(key, JSON.stringify(partialServerTelemetryEntity));

                    expect(browserSessionStorage.getServerTelemetry(key)).to.be.null;
                    expect(browserLocalStorage.getServerTelemetry(key)).to.be.null;
                });

                it("getServerTelemetry returns ServerTelemetryEntity", () => {
                    const testKey = "server-telemetry-clientId";
                    const testVal = new ServerTelemetryEntity();

                    browserLocalStorage.setServerTelemetry(testKey, testVal);
                    browserSessionStorage.setServerTelemetry(testKey, testVal);

                    expect(browserSessionStorage.getServerTelemetry(testKey)).to.deep.eq(testVal);
                    expect(browserSessionStorage.getServerTelemetry(testKey)).to.be.instanceOf(ServerTelemetryEntity);
                    expect(browserLocalStorage.getServerTelemetry(testKey)).to.deep.eq(testVal);
                    expect(browserLocalStorage.getServerTelemetry(testKey)).to.be.instanceOf(ServerTelemetryEntity);
                });
            });

            describe("AuthorityMetadata", () =>{
                const key = `authority-metadata-${TEST_CONFIG.MSAL_CLIENT_ID}-${Constants.DEFAULT_AUTHORITY_HOST}`;
                const testObj: AuthorityMetadataEntity = new AuthorityMetadataEntity();
                testObj.aliases = [Constants.DEFAULT_AUTHORITY_HOST];
                testObj.preferred_cache = Constants.DEFAULT_AUTHORITY_HOST;
                testObj.preferred_network = Constants.DEFAULT_AUTHORITY_HOST;
                testObj.canonical_authority = Constants.DEFAULT_AUTHORITY;
                testObj.authorization_endpoint = DEFAULT_OPENID_CONFIG_RESPONSE.body.authorization_endpoint;
                testObj.token_endpoint = DEFAULT_OPENID_CONFIG_RESPONSE.body.token_endpoint;
                testObj.end_session_endpoint = DEFAULT_OPENID_CONFIG_RESPONSE.body.end_session_endpoint;
                testObj.issuer = DEFAULT_OPENID_CONFIG_RESPONSE.body.issuer;
                testObj.aliasesFromNetwork = false;
                testObj.endpointsFromNetwork = false;

                it("getAuthorityMetadata() returns null if key is not in cache", () => {
                    expect(browserSessionStorage.getAuthorityMetadata(key)).to.be.null;
                    expect(browserLocalStorage.getAuthorityMetadata(key)).to.be.null;
                });

                it("getAuthorityMetadata() returns null if isAuthorityMetadataEntity returns false", () => {
                    sinon.stub(AuthorityMetadataEntity, "isAuthorityMetadataEntity").returns(false);
                    browserSessionStorage.setAuthorityMetadata(key, testObj);
                    browserLocalStorage.setAuthorityMetadata(key, testObj);

                    expect(browserSessionStorage.getAuthorityMetadata(key)).to.be.null;
                    expect(browserLocalStorage.getAuthorityMetadata(key)).to.be.null;
                    expect(browserSessionStorage.containsKey(key)).to.be.false;
                    expect(browserLocalStorage.containsKey(key)).to.be.false;
                    expect(browserLocalStorage.getAuthorityMetadataKeys()).to.contain(key);
                    expect(browserSessionStorage.getAuthorityMetadataKeys()).to.contain(key);
                });

                it("setAuthorityMetadata() and getAuthorityMetadata() sets and returns AuthorityMetadataEntity in-memory", () => {
                    browserSessionStorage.setAuthorityMetadata(key, testObj);
                    browserLocalStorage.setAuthorityMetadata(key, testObj);

                    expect(browserSessionStorage.getAuthorityMetadata(key)).to.deep.equal(testObj);
                    expect(browserLocalStorage.getAuthorityMetadata(key)).to.deep.equal(testObj);
                    expect(browserSessionStorage.containsKey(key)).to.be.false;
                    expect(browserLocalStorage.containsKey(key)).to.be.false;
                    expect(browserLocalStorage.getAuthorityMetadataKeys()).to.contain(key);
                    expect(browserSessionStorage.getAuthorityMetadataKeys()).to.contain(key);
                });

                it("clear() removes AuthorityMetadataEntity from in-memory storage", () => {
                    browserSessionStorage.setAuthorityMetadata(key, testObj);
                    browserLocalStorage.setAuthorityMetadata(key, testObj);

                    expect(browserSessionStorage.getAuthorityMetadata(key)).to.deep.equal(testObj);
                    expect(browserLocalStorage.getAuthorityMetadata(key)).to.deep.equal(testObj);
                    expect(browserLocalStorage.getAuthorityMetadataKeys()).to.contain(key);
                    expect(browserSessionStorage.getAuthorityMetadataKeys()).to.contain(key);

                    browserSessionStorage.clear();
                    browserLocalStorage.clear();
                    expect(browserSessionStorage.getAuthorityMetadata(key)).to.be.null;
                    expect(browserLocalStorage.getAuthorityMetadata(key)).to.be.null;
                    expect(browserLocalStorage.getAuthorityMetadataKeys().length).to.be.eq(0);
                    expect(browserSessionStorage.getAuthorityMetadataKeys().length).to.be.eq(0);
                });
            });

            describe("ThrottlingCache", () => {
                it("getThrottlingCache returns null if key not in cache", () => {
                    const key = "not-in-cache";
                    expect(browserSessionStorage.getServerTelemetry(key)).to.be.null;
                    expect(browserLocalStorage.getServerTelemetry(key)).to.be.null;
                });

                it("getThrottlingCache returns null if value is not JSON", () => {
                    const key = "testKey";
                    browserLocalStorage.setItem(key, "this is not json");
                    browserSessionStorage.setItem(key, "this is not json");

                    expect(browserSessionStorage.getThrottlingCache(key)).to.be.null;
                    expect(browserLocalStorage.getThrottlingCache(key)).to.be.null;
                });

                it("getThrottlingCache returns null if value is not throttling entity", () => {
                    const key = "testKey";
                    const partialThrottlingEntity = {
                        error: "error"
                    };

                    browserLocalStorage.setItem(key, JSON.stringify(partialThrottlingEntity));
                    browserSessionStorage.setItem(key, JSON.stringify(partialThrottlingEntity));

                    expect(browserSessionStorage.getThrottlingCache(key)).to.be.null;
                    expect(browserLocalStorage.getThrottlingCache(key)).to.be.null;
                });

                it("getThrottlingCache returns ThrottlingEntity", () => {
                    const testKey = "throttling";
                    const testVal = new ThrottlingEntity();
                    testVal.throttleTime = 60;

                    browserLocalStorage.setThrottlingCache(testKey, testVal);
                    browserSessionStorage.setThrottlingCache(testKey, testVal);

                    expect(browserSessionStorage.getThrottlingCache(testKey)).to.deep.eq(testVal);
                    expect(browserSessionStorage.getThrottlingCache(testKey)).to.be.instanceOf(ThrottlingEntity);
                    expect(browserLocalStorage.getThrottlingCache(testKey)).to.deep.eq(testVal);
                    expect(browserLocalStorage.getThrottlingCache(testKey)).to.be.instanceOf(ThrottlingEntity);
                });
            });
        });
    });

    describe("Interface functions with storeAuthStateInCookie=true", () => {

        let browserSessionStorage: BrowserCacheManager;
        let browserLocalStorage: BrowserCacheManager;
        let browserMemoryStorage: BrowserCacheManager;
        let cacheVal: string;
        let msalCacheKey: string;
        beforeEach(() => {
            cacheConfig.storeAuthStateInCookie = true;
            browserSessionStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            cacheConfig.cacheLocation = BrowserCacheLocation.LocalStorage;
            browserLocalStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            cacheConfig.cacheLocation = BrowserCacheLocation.MemoryStorage;
            browserMemoryStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            cacheVal = "cacheVal";
            msalCacheKey = browserSessionStorage.generateCacheKey("cacheKey");
        });

        afterEach(() => {
            browserSessionStorage.clear();
            browserLocalStorage.clear();
        });

        it("setTempCache()", () => {
            // sessionStorage
            browserSessionStorage.setTemporaryCache("cacheKey", cacheVal, true);
            expect(window.sessionStorage.getItem(msalCacheKey)).to.be.eq(cacheVal);
            expect(document.cookie).to.be.eq(`${msalCacheKey}=${cacheVal}`);
            browserSessionStorage.clearItemCookie(msalCacheKey);
            // localStorage
            browserLocalStorage.setTemporaryCache("cacheKey", cacheVal, true);
            expect(window.sessionStorage.getItem(msalCacheKey)).to.be.eq(cacheVal);
            expect(document.cookie).to.be.eq(`${msalCacheKey}=${cacheVal}`);
            browserLocalStorage.clearItemCookie(msalCacheKey);
            // browser memory
            browserMemoryStorage.setTemporaryCache("cacheKey", cacheVal, true);
            expect(browserMemoryStorage.getTemporaryCache(msalCacheKey)).to.be.eq(cacheVal);
            expect(document.cookie).to.be.eq(`${msalCacheKey}=${cacheVal}`);
            browserMemoryStorage.clearItemCookie(msalCacheKey);
        });

        it("getTempCache()", () => {
            const getCookieSpy = sinon.spy(BrowserCacheManager.prototype, "getItemCookie");
            // sessionStorage
            window.sessionStorage.setItem(msalCacheKey, cacheVal);
            browserSessionStorage.setItemCookie(msalCacheKey, cacheVal);
            expect(browserSessionStorage.getTemporaryCache("cacheKey", true)).to.be.eq(cacheVal);
            expect(getCookieSpy.returned(cacheVal)).to.be.true;
            expect(getCookieSpy.calledOnce).to.be.true;
            // localStorage
            window.localStorage.setItem(msalCacheKey, cacheVal);
            browserLocalStorage.setItemCookie(msalCacheKey, cacheVal);
            expect(browserLocalStorage.getTemporaryCache("cacheKey", true)).to.be.eq(cacheVal);
            expect(getCookieSpy.returned(cacheVal)).to.be.true;
            expect(getCookieSpy.calledTwice).to.be.true;
            // browser memory
            browserMemoryStorage.setItem(msalCacheKey, cacheVal);
            expect(browserMemoryStorage.getTemporaryCache("cacheKey", true)).to.be.eq(cacheVal);
            expect(getCookieSpy.returned(cacheVal)).to.be.true;
            expect(getCookieSpy.calledThrice).to.be.true;
        });

        it("removeItem()", () => {
            const clearCookieSpy = sinon.spy(BrowserCacheManager.prototype, "clearItemCookie");
            // sessionStorage
            browserSessionStorage.setTemporaryCache("cacheKey", cacheVal, true);
            browserSessionStorage.removeItem(msalCacheKey);
            expect(window.sessionStorage.getItem(msalCacheKey)).to.be.null;
            expect(document.cookie).to.be.empty;
            expect(clearCookieSpy.calledOnce).to.be.true;
            // localStorage
            browserLocalStorage.setTemporaryCache("cacheKey", cacheVal, true);
            browserLocalStorage.removeItem(msalCacheKey);
            expect(window.localStorage.getItem(msalCacheKey)).to.be.null;
            expect(document.cookie).to.be.empty;
            expect(clearCookieSpy.calledTwice).to.be.true;
            // browser memory
            browserMemoryStorage.setTemporaryCache("cacheKey", cacheVal, true);
            browserMemoryStorage.removeItem(msalCacheKey);
            expect(browserMemoryStorage.getItem(msalCacheKey)).to.be.null;
            expect(document.cookie).to.be.empty;
            expect(clearCookieSpy.calledThrice).to.be.true;
        });

        it("clear()", () => {
            // sessionStorage
            browserSessionStorage.setItem(msalCacheKey, cacheVal);
            browserSessionStorage.clear();
            expect(browserSessionStorage.getKeys()).to.be.empty;
            expect(document.cookie).to.be.empty;
            // localStorage
            browserLocalStorage.setTemporaryCache(msalCacheKey, cacheVal);
            browserLocalStorage.clear();
            expect(browserLocalStorage.getKeys()).to.be.empty;
            expect(document.cookie).to.be.empty;
            // browser memory
            browserMemoryStorage.setTemporaryCache(msalCacheKey, cacheVal);
            browserMemoryStorage.clear();
            expect(browserMemoryStorage.getKeys()).to.be.empty;
            expect(document.cookie).to.be.empty;
        });

        it("setTempCache() with item that contains ==", () => {
            msalCacheKey = `${Constants.CACHE_PREFIX}.${TEST_STATE_VALUES.ENCODED_LIB_STATE}`;
            // sessionStorage
            browserSessionStorage.setTemporaryCache(msalCacheKey, cacheVal);
            expect(window.sessionStorage.getItem(msalCacheKey)).to.be.eq(cacheVal);
            expect(document.cookie).to.be.eq(`${encodeURIComponent(msalCacheKey)}=${cacheVal}`);
            browserSessionStorage.clearItemCookie(msalCacheKey);
            // localStorage
            browserLocalStorage.setTemporaryCache(msalCacheKey, cacheVal);
            expect(window.sessionStorage.getItem(msalCacheKey)).to.be.eq(cacheVal);
            expect(document.cookie).to.be.eq(`${encodeURIComponent(msalCacheKey)}=${cacheVal}`);
            browserLocalStorage.clearItemCookie(msalCacheKey);
            // browser memory
            browserMemoryStorage.setTemporaryCache(msalCacheKey, cacheVal);
            expect(browserMemoryStorage.getTemporaryCache(msalCacheKey)).to.be.eq(cacheVal);
            expect(document.cookie).to.be.eq(`${encodeURIComponent(msalCacheKey)}=${cacheVal}`);
            browserMemoryStorage.clearItemCookie(msalCacheKey);
        });

        it("getTempCache() with item that contains ==", () => {
            msalCacheKey = `${Constants.CACHE_PREFIX}.${TEST_STATE_VALUES.ENCODED_LIB_STATE}`;
            const getCookieSpy = sinon.spy(BrowserCacheManager.prototype, "getItemCookie");
            // sessionStorage
            browserSessionStorage.setItem(msalCacheKey, cacheVal);
            browserSessionStorage.setItemCookie(msalCacheKey, cacheVal);
            expect(browserSessionStorage.getTemporaryCache(msalCacheKey)).to.be.eq(cacheVal);
            expect(getCookieSpy.returned(cacheVal)).to.be.true;
            expect(getCookieSpy.calledOnce).to.be.true;
            // localStorage
            browserLocalStorage.setItem(msalCacheKey, cacheVal);
            browserLocalStorage.setItemCookie(msalCacheKey, cacheVal);
            expect(browserLocalStorage.getTemporaryCache(msalCacheKey)).to.be.eq(cacheVal);
            expect(getCookieSpy.returned(cacheVal)).to.be.true;
            expect(getCookieSpy.calledTwice).to.be.true;
            // browser memory
            browserMemoryStorage.setItem(msalCacheKey, cacheVal);
            expect(browserLocalStorage.getTemporaryCache(msalCacheKey)).to.be.eq(cacheVal);
            expect(getCookieSpy.returned(cacheVal)).to.be.true;
            expect(getCookieSpy.calledThrice).to.be.true;
        });

        it("removeItem() with item that contains ==", () => {
            msalCacheKey = `${Constants.CACHE_PREFIX}.${TEST_STATE_VALUES.ENCODED_LIB_STATE}`;
            const clearCookieSpy = sinon.spy(BrowserCacheManager.prototype, "clearItemCookie");
            // sessionStorage
            browserSessionStorage.setTemporaryCache(msalCacheKey, cacheVal);
            browserSessionStorage.removeItem(msalCacheKey);
            expect(window.sessionStorage.getItem(msalCacheKey)).to.be.null;
            expect(document.cookie).to.be.empty;
            expect(clearCookieSpy.calledOnce).to.be.true;
            // localStorage
            browserLocalStorage.setItem(msalCacheKey, cacheVal);
            browserLocalStorage.removeItem(msalCacheKey);
            expect(window.sessionStorage.getItem(msalCacheKey)).to.be.null;
            expect(document.cookie).to.be.empty;
            expect(clearCookieSpy.calledTwice).to.be.true;
            // browser memory
            browserMemoryStorage.setTemporaryCache(msalCacheKey, cacheVal);
            browserMemoryStorage.removeItem(msalCacheKey);
            expect(browserMemoryStorage.getItem(msalCacheKey)).to.be.null;
            expect(document.cookie).to.be.empty;
            expect(clearCookieSpy.calledThrice).to.be.true;
        });

        it("clear() with item that contains ==", () => {
            msalCacheKey = `${Constants.CACHE_PREFIX}.${TEST_STATE_VALUES.ENCODED_LIB_STATE}`;
            // sessionStorage
            browserSessionStorage.setTemporaryCache(msalCacheKey, cacheVal);
            browserSessionStorage.clear();
            expect(browserSessionStorage.getKeys()).to.be.empty;
            expect(document.cookie).to.be.empty;
            // localStorage
            browserLocalStorage.setTemporaryCache(msalCacheKey, cacheVal);
            browserLocalStorage.clear();
            expect(browserLocalStorage.getKeys()).to.be.empty;
            expect(document.cookie).to.be.empty;
            // browser memory
            browserMemoryStorage.setTemporaryCache(msalCacheKey, cacheVal);
            browserMemoryStorage.clear();
            expect(browserMemoryStorage.getKeys()).to.be.empty;
            expect(document.cookie).to.be.empty;
        });
    });

    describe("Cookie operations", () => {

        let browserSessionStorage: BrowserCacheManager;
        let browserLocalStorage: BrowserCacheManager;
        let cacheVal: string;
        let msalCacheKey: string;
        beforeEach(() => {
            browserSessionStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            cacheConfig.cacheLocation = BrowserCacheLocation.LocalStorage;
            browserLocalStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            cacheVal = "cacheVal";
            msalCacheKey = browserSessionStorage.generateCacheKey("cacheKey");
        });

        it("setItemCookie()", () => {
            browserSessionStorage.setItemCookie(msalCacheKey, cacheVal);
            expect(document.cookie).to.be.eq(`${msalCacheKey}=${cacheVal}`);
            browserSessionStorage.clearItemCookie(msalCacheKey);
            browserLocalStorage.setItemCookie(msalCacheKey, cacheVal);
            expect(document.cookie).to.be.eq(`${msalCacheKey}=${cacheVal}`);
        });

        it("getItemCookie()", () => {
            browserSessionStorage.setItemCookie(msalCacheKey, cacheVal);
            expect(browserSessionStorage.getItemCookie(msalCacheKey)).to.be.eq(cacheVal);
            expect(browserLocalStorage.getItemCookie(msalCacheKey)).to.be.eq(cacheVal);
        });

        it("clearMsalCookie()", () => {
            browserSessionStorage.setItemCookie(msalCacheKey, cacheVal);
            expect(document.cookie).to.be.not.empty;
            browserSessionStorage.clearMsalCookies();
            expect(document.cookie).to.be.empty;
            
            const testCookieKey = "cookie"
            const testCookie = `${testCookieKey}=thisIsACookie`;
            const testCookieWithPath = "cookie=thisIsACookie;path=/;";
            browserSessionStorage.setItemCookie(msalCacheKey, cacheVal);
            expect(document.cookie).to.be.not.empty;
            document.cookie = testCookieWithPath;
            browserSessionStorage.clearMsalCookies();
            expect(document.cookie).to.be.eq(testCookie);
            browserSessionStorage.clearItemCookie(testCookieKey);
        });

        it("clearItemCookie()", () => {
            browserSessionStorage.setItemCookie(msalCacheKey, cacheVal);
            browserSessionStorage.clearItemCookie(msalCacheKey);
            expect(document.cookie).to.be.empty;

            browserLocalStorage.setItemCookie(msalCacheKey, cacheVal);
            browserSessionStorage.clearItemCookie(msalCacheKey);
            expect(document.cookie).to.be.empty;
        });

        it("getCookieExpirationTime()", () => {
            const COOKIE_LIFE_MULTIPLIER = 24 * 60 * 60 * 1000;
            const currentTime = new Date().getTime();
            sinon.stub(Date.prototype, "getTime").returns(currentTime);
            const cookieLifeDays = 1;
            const expectedDate = new Date(currentTime + (cookieLifeDays * COOKIE_LIFE_MULTIPLIER));
            expect(browserLocalStorage.getCookieExpirationTime(cookieLifeDays)).to.be.eq(expectedDate.toUTCString());
        });
    });

    describe("Helpers", () => {

        it("generateAuthorityKey() creates a valid cache key for authority strings", () => {
            const browserStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            const authorityKey = browserStorage.generateAuthorityKey(TEST_STATE_VALUES.TEST_STATE_REDIRECT);
            expect(authorityKey).to.be.eq(`${Constants.CACHE_PREFIX}.${TEST_CONFIG.MSAL_CLIENT_ID}.${TemporaryCacheKeys.AUTHORITY}.${RANDOM_TEST_GUID}`);
        });

        it("generateNonceKey() create a valid cache key for nonce strings", () => {
            const browserStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            const nonceKey = browserStorage.generateNonceKey(TEST_STATE_VALUES.TEST_STATE_REDIRECT);
            expect(nonceKey).to.be.eq(`${Constants.CACHE_PREFIX}.${TEST_CONFIG.MSAL_CLIENT_ID}.${TemporaryCacheKeys.NONCE_IDTOKEN}.${RANDOM_TEST_GUID}`);
        });

        it("updateCacheEntries() correctly updates the authority, state and nonce in the cache", () => {
            const browserStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            const testNonce = "testNonce";
            const stateString = TEST_STATE_VALUES.TEST_STATE_REDIRECT;
            ProtocolUtils.parseRequestState(browserCrypto, stateString).libraryState.id;
            browserStorage.updateCacheEntries(stateString, testNonce, `${Constants.DEFAULT_AUTHORITY}/`);

            const stateKey = browserStorage.generateStateKey(stateString);
            const nonceKey = browserStorage.generateNonceKey(stateString);
            const authorityKey = browserStorage.generateAuthorityKey(stateString);

            expect(window.sessionStorage[`${stateKey}`]).to.be.eq(stateString);
            expect(window.sessionStorage[`${nonceKey}`]).to.be.eq(testNonce);
            expect(window.sessionStorage[`${authorityKey}`]).to.be.eq(`${Constants.DEFAULT_AUTHORITY}/`);
        });

        it("resetTempCacheItems() resets all temporary cache items with the given state", () => {
            const stateString = TEST_STATE_VALUES.TEST_STATE_REDIRECT;
            const browserStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            browserStorage.updateCacheEntries(stateString, "nonce", `${TEST_URIS.DEFAULT_INSTANCE}/`);
            browserStorage.setItem(TemporaryCacheKeys.REQUEST_PARAMS, "TestRequestParams");
            browserStorage.setItem(TemporaryCacheKeys.ORIGIN_URI, TEST_URIS.TEST_REDIR_URI);

            browserStorage.resetRequestCache(stateString);
            const nonceKey = browserStorage.generateNonceKey(stateString);
            const authorityKey = browserStorage.generateAuthorityKey(stateString);
            expect(window.sessionStorage[`${Constants.CACHE_PREFIX}.${TEST_CONFIG.MSAL_CLIENT_ID}.${nonceKey}`]).to.be.undefined;
            expect(window.sessionStorage[`${Constants.CACHE_PREFIX}.${TEST_CONFIG.MSAL_CLIENT_ID}.${authorityKey}`]).to.be.undefined;
            expect(window.sessionStorage[`${Constants.CACHE_PREFIX}.${TEST_CONFIG.MSAL_CLIENT_ID}.${TemporaryCacheKeys.REQUEST_STATE}`]).to.be.undefined;
            expect(window.sessionStorage[`${Constants.CACHE_PREFIX}.${TEST_CONFIG.MSAL_CLIENT_ID}.${TemporaryCacheKeys.REQUEST_PARAMS}`]).to.be.undefined;
            expect(window.sessionStorage[`${Constants.CACHE_PREFIX}.${TEST_CONFIG.MSAL_CLIENT_ID}.${TemporaryCacheKeys.ORIGIN_URI}`]).to.be.undefined;
        });

        it("Successfully retrieves and decodes response from cache", async () => {
            const browserStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            const tokenRequest: AuthorizationCodeRequest = {
                redirectUri: `${TEST_URIS.DEFAULT_INSTANCE}`,
                scopes: [Constants.OPENID_SCOPE, Constants.PROFILE_SCOPE],
                code: "thisIsAnAuthCode",
                codeVerifier: TEST_CONFIG.TEST_VERIFIER,
                authority: `${Constants.DEFAULT_AUTHORITY}/`,
                correlationId: `${RANDOM_TEST_GUID}`,
                authenticationScheme: AuthenticationScheme.BEARER
            };

            browserStorage.setTemporaryCache(TemporaryCacheKeys.REQUEST_PARAMS, browserCrypto.base64Encode(JSON.stringify(tokenRequest)), true);

            const cachedRequest = browserStorage.getCachedRequest(RANDOM_TEST_GUID, browserCrypto);
            expect(cachedRequest).to.be.deep.eq(tokenRequest);

            // expect(() => browserStorage.getCachedRequest(RANDOM_TEST_GUID, cryptoObj)).to.throw(BrowserAuthErrorMessage.tokenRequestCacheError.desc);
        });

        it("Throws error if request cannot be retrieved from cache", async () => {
            const browserStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            const cryptoObj = new CryptoOps();
            // browserStorage.setItem(TemporaryCacheKeys.REQUEST_PARAMS, cryptoObj.base64Encode(JSON.stringify(tokenRequest)));

            expect(() => browserStorage.getCachedRequest(RANDOM_TEST_GUID, cryptoObj)).to.throw(BrowserAuthErrorMessage.noTokenRequestCacheError.desc);
        });

        it("Throws error if cached request cannot be parsed correctly", async () => {
            let dbStorage = {};
            sinon.stub(DatabaseStorage.prototype, "open").callsFake(async (): Promise<void> => {
                dbStorage = {};
            });
            const browserStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            const cryptoObj = new CryptoOps();
            const tokenRequest: AuthorizationCodeRequest = {
                redirectUri: `${TEST_URIS.DEFAULT_INSTANCE}`,
                scopes: [Constants.OPENID_SCOPE, Constants.PROFILE_SCOPE],
                code: "thisIsAnAuthCode",
                codeVerifier: TEST_CONFIG.TEST_VERIFIER,
                authority: `${Constants.DEFAULT_AUTHORITY}/`,
                correlationId: `${RANDOM_TEST_GUID}`,
                authenticationScheme: AuthenticationScheme.BEARER
            };
            const stringifiedRequest = JSON.stringify(tokenRequest);
            browserStorage.setTemporaryCache(TemporaryCacheKeys.REQUEST_PARAMS, stringifiedRequest.substring(0, stringifiedRequest.length / 2), true);
            expect(() => browserStorage.getCachedRequest(RANDOM_TEST_GUID, cryptoObj)).to.throw(BrowserAuthErrorMessage.unableToParseTokenRequestCacheError.desc);
        });

        it("Uses authority from cache if not present in cached request", async () => {
            let dbStorage = {};
            sinon.stub(DatabaseStorage.prototype, "open").callsFake(async (): Promise<void> => {
                dbStorage = {};
            });
            const browserStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);
            // Set up cache
            const authorityKey = browserStorage.generateAuthorityKey(TEST_STATE_VALUES.TEST_STATE_REDIRECT);
            const alternateAuthority = `${TEST_URIS.ALTERNATE_INSTANCE}/common/`;
            browserStorage.setItem(authorityKey, alternateAuthority);

            const cachedRequest: AuthorizationCodeRequest = {
                redirectUri: TEST_URIS.TEST_REDIR_URI,
                code: "thisIsACode",
                codeVerifier: TEST_CONFIG.TEST_VERIFIER,
                correlationId: RANDOM_TEST_GUID,
                scopes: [TEST_CONFIG.MSAL_CLIENT_ID],
                authority: "",
                authenticationScheme: AuthenticationScheme.BEARER
            };
            const stringifiedRequest = browserCrypto.base64Encode(JSON.stringify(cachedRequest));
            browserStorage.setTemporaryCache(TemporaryCacheKeys.REQUEST_PARAMS, stringifiedRequest, true);

            // Perform test
            const tokenRequest = browserStorage.getCachedRequest(TEST_STATE_VALUES.TEST_STATE_REDIRECT, browserCrypto);
            expect(tokenRequest.authority).to.be.eq(alternateAuthority);
        });

        it("cleanRequestByInteractionType() returns early if state is not present", () => {
            let dbStorage = {};
            sinon.stub(DatabaseStorage.prototype, "open").callsFake(async (): Promise<void> => {
                dbStorage = {};
            });
            const browserStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);

            const cacheKey = "cacheKey";
            const cacheValue = "cacheValue";
            browserStorage.setTemporaryCache(cacheKey, cacheValue, true);
            browserStorage.cleanRequestByInteractionType(InteractionType.Redirect);
            expect(browserStorage.getTemporaryCache(cacheKey, true)).to.be.eq(cacheValue);
            browserStorage.clear();
        });

        it("cleanRequestByInteractionType() cleans cache", () => {
            let dbStorage = {};
            sinon.stub(DatabaseStorage.prototype, "open").callsFake(async (): Promise<void> => {
                dbStorage = {};
            });
            const browserStorage = new BrowserCacheManager(TEST_CONFIG.MSAL_CLIENT_ID, cacheConfig, browserCrypto, logger);

            const browserState: BrowserStateObject = {
                interactionType: InteractionType.Redirect
            };
            
            sinon.stub(CryptoOps.prototype, "createNewGuid").returns(RANDOM_TEST_GUID);
            const state = ProtocolUtils.setRequestState(
                browserCrypto,
                undefined,
                browserState
            );
            const cacheKey = `cacheKey.${state}`;
            const cacheValue = "cacheValue";
            browserStorage.setTemporaryCache(cacheKey, cacheValue, true);
            browserStorage.setTemporaryCache(`${TemporaryCacheKeys.REQUEST_STATE}.${RANDOM_TEST_GUID}`, state, true);
            browserStorage.cleanRequestByInteractionType(InteractionType.Redirect);
            expect(browserStorage.getKeys()).to.be.empty;
        });
    });
});
