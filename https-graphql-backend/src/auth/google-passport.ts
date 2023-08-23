import express from "express";
import { UserDbObject } from "allotr-graphql-schema-types";
import { ObjectId } from "mongodb"

import passport from "passport";
import { USERS } from "../consts/collections";
import { getMongoDBConnection } from "../utils/mongodb-connector";

const cors = require('cors');

function isLoggedIn(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (req.user) {
        next();
    } else {
        res.sendStatus(401);
    }
}



function initializeGooglePassport(app: express.Express) {
    const corsOptions = {
        origin: (origin, next) => {
            // Test for main domain and all subdomains
            if (origin == null || origin === 'https://allotr.eu' || /^https:\/\/\w+?\.allotr\.eu$/gm.test(origin)) {
                next(null, true)
            } else {
                next(new Error('Not allowed by CORS'))
            }
        },
        credentials: true // <-- REQUIRED backend setting
    };


    const passportMiddleware = passport.initialize();
    const passportSessionMiddleware = passport.session();

    app.use(cors(corsOptions));

    app.use(passportMiddleware)
    app.use(passportSessionMiddleware)


    passport.serializeUser<ObjectId>((user: any, done) => {
        done(null, user._id);
    });

    passport.deserializeUser<ObjectId>(async (id, done) => {
        try {
            const db = await (await getMongoDBConnection()).db;
            const idToSearch = new ObjectId(id);
            const user = await db.collection<UserDbObject>(USERS).findOne({ _id: idToSearch });
            done(null, user);
        } catch (e) {
            console.log("error deserializing user", e);
        }
    });

}
export { initializeGooglePassport, isLoggedIn }