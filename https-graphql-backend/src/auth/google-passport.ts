import express from "express";
import { EnvLoader } from "../utils/env-loader";
import { MongoDBSingleton } from "../utils/mongodb-singleton";
import { UserDbObject, GlobalRole } from "allotr-graphql-schema-types";
import { ObjectId } from "mongodb"

import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";
import MongoStore from 'connect-mongo';
const cors = require('cors');

// This NEEDS to be executed first
require('dotenv').config();

function isLoggedIn(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (req.user) {
        next();
    } else {
        res.sendStatus(401);
    }
}

function initializeGooglePassport(app: express.Express) {
    const {
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        MONGO_DB_ENDPOINT,
        SESSION_SECRET,
        REDIRECT_URL } = EnvLoader.getInstance().loadedVariables;
    const corsOptions = {
        origin: REDIRECT_URL,
        credentials: true // <-- REQUIRED backend setting
    };
    app.use(cors(corsOptions));

    app.use(
        session({
            secret: SESSION_SECRET,
            resave: false,
            saveUninitialized: false,
            cookie: { domain: '.allotr.eu' },
            store: new MongoStore({ mongoUrl: MONGO_DB_ENDPOINT }),
        })
    )
    app.use(passport.initialize())
    app.use(passport.session())

    passport.use(
        new GoogleStrategy(
            {
                clientID: GOOGLE_CLIENT_ID,
                clientSecret: GOOGLE_CLIENT_SECRET,
                callbackURL: "/auth/google/redirect",
                passReqToCallback: false
            },
            async (accessToken, refreshToken, profile, done) => {
                // passport callback function
                const db = await MongoDBSingleton.getInstance().db;
                const currentUser = await db.collection<UserDbObject>('users').findOne({ oauthIds: { googleId: profile.id } })
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
                        pushURLs: []
                    };
                    await db.collection<UserDbObject>('users').insertOne(userToCreate)
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
            const user = await db.collection<UserDbObject>('users').findOne({ _id: idToSearch });
            done(null, user);
        } catch (e) {
            console.log("error deserializing user");
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
export { initializeGooglePassport, isLoggedIn }