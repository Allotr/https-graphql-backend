
import express from "express";

import { getLoadedEnvVariables } from "../utils/env-loader";

import { isLoggedIn } from "../auth/google-passport";
import * as webPush from "web-push"
import { UserDbObject, WebPushSubscription } from "allotr-graphql-schema-types";
import { USERS } from "../consts/collections";


function initializeWebPush(app: express.Express) {

    // Web Push
    // API
    const { VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, REDIRECT_URL } = getLoadedEnvVariables();

    webPush.setVapidDetails(
        REDIRECT_URL,
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
    );


    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.get('/webpush/vapidPublicKey', isLoggedIn, (req, res) => {
        res.send(VAPID_PUBLIC_KEY);
    });

    // Register a subscription by adding it to the `subscriptions` array.
    app.post('/webpush/register', isLoggedIn, async (req, res) => {
        const subscription = req?.body?.subscription as WebPushSubscription;
        const { _id } = req.user as UserDbObject;

        const db = await (await req.mongoDBConnection).db;

        await db.collection(USERS).updateOne({
            _id, "webPushSubscriptions.endpoint": { $ne: subscription.endpoint }
        }, {
            $push: {
                "webPushSubscriptions": subscription
            }
        }, {
            arrayFilters: [],
        })

        res.sendStatus(201);
    });

    // Unregister a subscription by removing it from the `subscriptions` array
    app.post('/webpush/unregister', isLoggedIn, async (req, res) => {
        const subscription = req?.body?.subscription as WebPushSubscription;
        const { _id } = req.user as UserDbObject;
        const db = await (await req.mongoDBConnection).db;

        await db.collection(USERS).updateOne({
            _id
        }, {
            $pull: {
                "webPushSubscriptions": subscription
            }
        }, {
            arrayFilters: [],
        })
        res.sendStatus(201);
    });



}

// Send notification to the push service. Remove the subscription from the
// `subscriptions` array if the  push service responds with an error.
// Subscription has been cancelled or expired.
async function sendNotification(subscription: webPush.PushSubscription, payload?: string | Buffer | null | undefined) {
    try {
        await webPush.sendNotification(subscription, payload)
        // console.log('Push Application Server - Notification sent to ' + subscription.endpoint);

    } catch (e) {
        // console.log("Error pushing mesage to user", e);
    }
}



export { initializeWebPush, sendNotification }