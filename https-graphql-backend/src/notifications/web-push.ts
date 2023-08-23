
import express from "express";

import { getLoadedEnvVariables } from "../utils/env-loader";

import * as webPush from "web-push"
import fetch, { Headers } from "node-fetch";


function initializeWebPush(app: express.Express) {

    // Web Push
    // API
    const { VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, REDIRECT_URL } = getLoadedEnvVariables();

    webPush.setVapidDetails(
        REDIRECT_URL,
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
    );


}

// Send notification to the push service. Remove the subscription from the
// `subscriptions` array if the  push service responds with an error.
// Subscription has been cancelled or expired.
async function sendNotification(subscription: webPush.PushSubscription, req: express.Request) {
    const cookie = req.headers.cookie;
    const headers = new Headers();
    headers.set('cookie', cookie ?? "");
    headers.set('Content-Type', 'application/json')
    try {
        await fetch("/webpush/notify",{
            body: JSON.stringify(subscription),
            headers,
            method: 'POST'
        })
        // console.log('Push Application Server - Notification sent to ' + subscription.endpoint);

    } catch (e) {
        console.log("ERROR", e);
        // console.log("Error pushing mesage to user", e);
    }
}



export { initializeWebPush, sendNotification }