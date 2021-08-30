
import { Resolvers, OperationResult, ResourceDbObject, UserDbObject, LocalRole, TicketStatusCode, ErrorCode, User, ResourceCard, Ticket } from "allotr-graphql-schema-types";
import { MongoDBSingleton } from "../../utils/mongodb-singleton";
import { RedisSingleton } from "../../utils/redis-singleton";
import { ObjectId, SortDirection } from "mongodb"
import { compareDates, customTryCatch } from "../../utils/data-util";
import { CustomTryCatch } from "../../types/custom-try-catch";

export const ResourceResolvers: Resolvers = {
    Query: {
        myResources: async (parent, args, context) => {
            const db = await MongoDBSingleton.getInstance().db;


            const myCurrentTicket = await db.collection<ResourceDbObject>("resources").find({
                "tickets.user._id": context.user._id,
                "tickets.statuses.statusCode": {
                    $ne: TicketStatusCode.Revoked
                }
            }, {
                projection: {
                    "tickets.$": 1,
                    name: 1,
                    createdBy: 1,
                    description: 1,
                    maxActiveTickets: 1,
                    lastModificationDate: 1,
                    _id: 1,
                    creationDate: 1,
                    activeUserCount: 1
                }
            }).sort({
                lastModificationDate: -1 as SortDirection
            }).toArray();

            const resourceList = myCurrentTicket
                .map(({ _id, creationDate, createdBy, lastModificationDate, maxActiveTickets, name, tickets, description, activeUserCount }) => {
                    const lastStatus = tickets?.[0]?.statuses.reduce((latest, current) => compareDates(current.timestamp, latest.timestamp) > 0 ? current : latest);
                    return {
                        activeUserCount,
                        creationDate,
                        createdBy: { userId: createdBy?._id?.toHexString(), username: createdBy?.username ?? "" },
                        lastModificationDate,
                        maxActiveTickets,
                        name,
                        description,
                        lastStatusTimestamp: lastStatus.timestamp,
                        role: tickets?.[0].user?.role as LocalRole,
                        statusCode: lastStatus.statusCode as TicketStatusCode,
                        ticketId: tickets?.[0]._id?.toHexString(),
                        resourceId: _id?.toHexString() ?? ""
                    }

                })

            return resourceList;
        }
    },
    Mutation: {
        createResource: async (parent, args, context) => {
            const { name, description, maxActiveTickets, userList } = args.resource
            const timestamp = new Date();

            const db = await MongoDBSingleton.getInstance().db;

            // Check if user has entered himself as admin, it's important to do so
            const myUserIndex = userList.findIndex(user => new ObjectId(user.id).equals(context.user._id));
            if (myUserIndex === -1) {
                userList.push({ id: new ObjectId(context.user._id).toHexString(), role: LocalRole.ResourceAdmin });
            }

            // Force the role of my user to be admin when creating
            userList[myUserIndex] = { id: new ObjectId(context.user._id).toHexString(), role: LocalRole.ResourceAdmin }


            const userNameList = userList
                .map<Promise<[string, CustomTryCatch<UserDbObject | null | undefined>]>>(async ({ id }) =>
                    [
                        id,
                        await customTryCatch(db.collection<UserDbObject>('users').findOne({ _id: new ObjectId(id) }, { projection: { username: 1 } }))
                    ]);
            const { error, result: userListResult } = await customTryCatch(Promise.all(userNameList));

            if (error != null || userListResult == null) {
                return {
                    status: OperationResult.Error,
                    errorCode: ErrorCode.BadData,
                    errorMessage: "Some user in the list does not exist. Please, try with other users",
                    newObjectId: null
                }
            }
            const userNameMap = Object.fromEntries(userListResult.map(([id, { result: user }]) => [id, user?.username ?? ""]));

            // Find all results
            const result = await db.collection<ResourceDbObject>('resources').insertOne({
                creationDate: timestamp,
                lastModificationDate: timestamp,
                maxActiveTickets,
                name,
                description,
                tickets: userList.map(({ id, role }) => ({
                    _id: new ObjectId(),
                    creationDate: timestamp,
                    statuses: [
                        { statusCode: TicketStatusCode.Initialized, timestamp }
                    ],
                    user: { role, _id: new ObjectId(id), username: userNameMap?.[id] },
                })),
                createdBy: { _id: context.user._id, username: context.user.username },
                activeUserCount: 0
            })

            if (result == null) {
                return { status: OperationResult.Error, newObjectId: null };
            }

            return { status: OperationResult.Ok, newObjectId: result.insertedId.toHexString() };
        }
    }
}