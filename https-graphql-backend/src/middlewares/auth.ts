import { getLoadedEnvVariables } from "../utils/env-loader";
import { Store } from "express-session";
import MongoStore from 'connect-mongo';
import { signedCookie } from "cookie-parser"
import cookie from "cookie";
import { ObjectId } from "mongodb";
import { GraphQLContext } from "src/types/yoga-context";
import { GraphQLError } from "graphql";

let store: Store;
let sessionSecret: string;

function initializeSessionStore() {
    const {
        MONGO_DB_ENDPOINT,
        SESSION_SECRET
    } = getLoadedEnvVariables();

    store = new MongoStore({ mongoUrl: MONGO_DB_ENDPOINT });
    sessionSecret = SESSION_SECRET;
}

function getSessionIdFromCookie(request: Request): string {
    const cookieList = request.headers.get('cookie') ?? "";
    const parsedCookie = cookie.parse(cookieList);
    const sid = parsedCookie?.['connect.sid'];
    const sidParsed = signedCookie(sid, sessionSecret);

    if (!sidParsed) {
        throw new Error("Bad cookie");
    }
    return sidParsed
}

async function getUserIdFromSessionStore(sid: string): Promise<ObjectId | null> {
    return new Promise((resolve) => {
        store.get(sid, (err, session: any) => {
            if (err != null) {
                resolve(null);
                return;
            }

            const userId = session?.passport?.user ?? "";

            resolve(new ObjectId(userId));
        })
    })
}

function isLoggedIn(context: GraphQLContext): void {
    if (context?.user?._id == null){
        throw new GraphQLError("Unauthorized, log in!")
    }

    return;
}

function logoutSession(sid: string): Promise<void> {
    return new Promise((resolve, reject) => {
        store.destroy(sid, (err) => {
            if (err != null) {
                console.log("Error logging out")
                reject();
            }

            resolve();
        })
    })
}


export { isLoggedIn, initializeSessionStore, getUserIdFromSessionStore, getSessionIdFromCookie, logoutSession }