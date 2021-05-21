import { ProtocolUtils } from "../../src/utils/ProtocolUtils";
import { RANDOM_TEST_GUID, TEST_CONFIG, TEST_POP_VALUES } from "../test_kit/StringConstants";
import { ICrypto, PkceCodes } from "../../src/crypto/ICrypto";
import { Constants } from "../../src/utils/Constants";
import sinon from "sinon";
import { ClientAuthError, ClientAuthErrorMessage } from "../../src";

describe("ProtocolUtils.ts Class Unit Tests", () => {

    const userState = "userState";
    const decodedLibState = `{"id":"${RANDOM_TEST_GUID}"}`;
    const encodedLibState = `eyJpZCI6IjExNTUzYTliLTcxMTYtNDhiMS05ZDQ4LWY2ZDRhOGZmODM3MSJ9`;
    const testState = `${encodedLibState}${Constants.RESOURCE_DELIM}${userState}`;

    let cryptoInterface: ICrypto;
    beforeEach(() => {
        cryptoInterface = {
            createNewGuid(): string {
                return RANDOM_TEST_GUID;
            },
            base64Decode(input: string): string {
                switch (input) {
                    case TEST_POP_VALUES.ENCODED_REQ_CNF:
                        return TEST_POP_VALUES.DECODED_REQ_CNF;
                    case encodedLibState:
                        return decodedLibState;
                    default:
                        return input;
                }
            },
            base64Encode(input: string): string {
                switch (input) {
                    case TEST_POP_VALUES.DECODED_REQ_CNF:
                        return TEST_POP_VALUES.ENCODED_REQ_CNF;
                    case `${decodedLibState}`:
                        return encodedLibState;
                    default:
                        return input;
                }
            },
            async generatePkceCodes(): Promise<PkceCodes> {
                return {
                    challenge: TEST_CONFIG.TEST_CHALLENGE,
                    verifier: TEST_CONFIG.TEST_VERIFIER,
                };
            },
            async getPublicKeyThumbprint(): Promise<string> {
                return TEST_POP_VALUES.KID;
            },
            async signJwt(): Promise<string> {
                return "";
            }
        };
    });

    afterEach(() => {
        sinon.restore();
    });

    it("setRequestState() appends library state to given state", () => {
        const requestState = ProtocolUtils.setRequestState(cryptoInterface, userState);
        expect(requestState).toBe(testState);
    });

    it("setRequestState() only creates library state", () => {
        const requestState = ProtocolUtils.setRequestState(cryptoInterface, "");
        expect(requestState).toBe(encodedLibState);
    });

    it("setRequestState throws error if no crypto object is passed to it", () => {
        // @ts-ignore
        expect(() => ProtocolUtils.setRequestState(null, userState)).toThrowError(ClientAuthError);
        // @ts-ignore
        expect(() => ProtocolUtils.setRequestState(null, userState)).toThrowError(ClientAuthErrorMessage.noCryptoObj.desc);
    });

    it("parseRequestState() throws error if given state is null or empty", () => {
        expect(() => ProtocolUtils.parseRequestState(cryptoInterface, "")).toThrowError(ClientAuthError);
        expect(() => ProtocolUtils.parseRequestState(cryptoInterface, "")).toThrowError(ClientAuthErrorMessage.invalidStateError.desc);

        // @ts-ignore
        expect(() => ProtocolUtils.parseRequestState(cryptoInterface, null)).toThrowError(ClientAuthError);
        // @ts-ignore
        expect(() => ProtocolUtils.parseRequestState(cryptoInterface, null)).toThrowError(ClientAuthErrorMessage.invalidStateError.desc);
    });

    it("parseRequestState() returns empty userRequestState if no resource delimiter found in state string", () => {
        const requestState = ProtocolUtils.parseRequestState(cryptoInterface, decodedLibState);
        expect(requestState.userRequestState).toHaveLength(0);
    });

    it("parseRequestState() correctly splits the state by the resource delimiter", () => {
        const requestState = ProtocolUtils.parseRequestState(cryptoInterface, testState);
        expect(requestState.userRequestState).toBe(userState);
    });
});
