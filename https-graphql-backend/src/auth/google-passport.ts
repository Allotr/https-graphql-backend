import express from "express";
import { EnvLoader } from "../utils/env-loader";
import { MongoDBSingleton } from "../utils/mongodb-singleton";
import { UserDbObject, GlobalRole } from "allotr-graphql-schema-types";
import { ObjectId } from "mongodb"

import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";
import MongoStore from 'connect-mongo';
import { USERS } from "../consts/collections";
// import { GraphQLLocalStrategy, buildContext, createOnConnect } from 'graphql-passport';
const cors = require('cors');

function isLoggedIn(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (req.user) {
        next();
    } else {
        res.sendStatus(401);
    }
}

// Initialize passport data
const { MONGO_DB_ENDPOINT, SESSION_SECRET } = EnvLoader.getInstance().loadedVariables;

const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { domain: '.allotr.eu' },
    store: new MongoStore({ mongoUrl: MONGO_DB_ENDPOINT }),
})

const passportMiddleware = passport.initialize();
const passportSessionMiddleware = passport.session();


function initializeGooglePassport(app: express.Express) {
    const {
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        GOOGLE_CALLBACK_URL,
        REDIRECT_URL } = EnvLoader.getInstance().loadedVariables;
    const corsOptions = {
        origin: REDIRECT_URL,
        credentials: true // <-- REQUIRED backend setting
    };
    app.use(cors(corsOptions));

    app.use(sessionMiddleware)
    app.use(passportMiddleware)
    app.use(passportSessionMiddleware)

    passport.use(
        new GoogleStrategy(
            {
                clientID: GOOGLE_CLIENT_ID,
                clientSecret: GOOGLE_CLIENT_SECRET,
                callbackURL: GOOGLE_CALLBACK_URL,
                passReqToCallback: false
            },
            async (accessToken, refreshToken, profile, done) => {
                // passport callback function
                const db = await MongoDBSingleton.getInstance().db;
                const currentUser = await db.collection<UserDbObject>(USERS).findOne({ oauthIds: { googleId: profile.id } })
                //check if user already exists in our db with the given profile ID
                if (currentUser) {
                    //if we already have a record with the given profile ID
                    done(null, currentUser);
                } else {
                    //if not, create a new user 
                    const userToCreate = {
                        username: profile._json.email.split('@')?.[0],
                        globalRole: GlobalRole.User,
                        creationDate: new Date(),
                        name: profile.name?.givenName,
                        surname: profile.name?.familyName,
                        userPreferences: {},
                        oauthIds: { googleId: profile.id },
                        webPushSubscriptions: []
                    };
                    await db.collection<UserDbObject>(USERS).insertOne(userToCreate)
                    await db.collection<UserDbObject>(USERS).createIndex({ username: "text", name: "text", surname: "text" })

                    done(null, userToCreate);
                }
            })
    )

    passport.serializeUser<ObjectId>((user: any, done) => {
        done(null, user._id);
    });

    passport.deserializeUser<ObjectId>(async (id, done) => {
        try {
            const db = await MongoDBSingleton.getInstance().db;
            const idToSearch = new ObjectId(id);
            const user = await db.collection<UserDbObject>(USERS).findOne({ _id: idToSearch });
            done(null, user);
        } catch (e) {
            console.log("error deserializing user", e);
        }
    });


    app.get("/", (req, res) => res.json({ message: "You are not logged in" }));

    app.get("/failed", (req, res) => res.send("Failed"));

    // Google Oauth
    app.get("/auth/google", passport.authenticate("google", {
        scope: ["profile", "email"]
    }));

    app.get('/auth/google/redirect',
        passport.authenticate('google', {
            failureRedirect: '/failed', successRedirect: REDIRECT_URL
        }));

    app.get("/auth/google/logout", (req, res) => {
        req.logout();
        res.redirect(REDIRECT_URL);
    });
}
export { initializeGooglePassport, isLoggedIn, sessionMiddleware, passportMiddleware, passportSessionMiddleware }