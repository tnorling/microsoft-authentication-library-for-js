import React, { useState, useEffect } from "react";
import { MsalProvider, AuthenticatedTemplate, UnauthenticatedTemplate, useMsal } from "@azure/msal-react";
import { PublicClientApplication, EventType, InteractionType } from "@azure/msal-browser";
import { msalConfig, loginRequest, forgotPasswordRequest } from "./authConfig";
import { PageLayout } from "./ui.jsx";
import Button from "react-bootstrap/Button";
import "./styles/App.css";

const ProfileContent = () => {
    const { instance, accounts } = useMsal();
    const [tokenData, setTokenData] = useState(null);

    function RequestProfileData() {
        instance.acquireTokenSilent({
            ...loginRequest,
            account: accounts[0]
        }).then((response) => {
            setTokenData(response);
        });
    }

    return (
        <>
            <h5 className="card-title">Welcome {accounts[0].name}</h5>
            {tokenData ? 
                <p>{JSON.stringify(tokenData)}</p>
                :
                <Button variant="secondary" onClick={RequestProfileData}>Request Access Token</Button>
            }
        </>
    );
};

const MainContent = () => {    
    const { instance } = useMsal();

    useEffect(() => {
        const callbackId = instance.addEventCallback((message) => {
            if (message.eventType === EventType.LOGIN_FAILURE && message.interactionType === InteractionType.Redirect) {
                if (message.error.errorMessage && message.error.errorMessage.indexOf("AADB2C90118") > -1) {
                    instance.loginRedirect(forgotPasswordRequest)
                    .then(() => {
                        window.alert("Password has been reset successfully. \nPlease sign-in with your new password.");
                    });
                }
            }
        });

        return () => {
            if (callbackId) {
                instance.removeEventCallback(callbackId);
            }
        };
    }, [instance]);

    return (
        <div className="App">
            <AuthenticatedTemplate>
                <ProfileContent />
            </AuthenticatedTemplate>

            <UnauthenticatedTemplate>
                <h5 className="card-title">Please sign-in to see your profile information.</h5>
            </UnauthenticatedTemplate>
        </div>
    );
};

export default function App() {
    const msalInstance = new PublicClientApplication(msalConfig);

    return (
        <MsalProvider instance={msalInstance}>
            <PageLayout>
                <MainContent />
            </PageLayout>
        </MsalProvider>
    );
}
