
import { Resolvers, OperationResult, ResourceDbObject, UserDbObject, LocalRole, TicketStatusCode, ErrorCode,  ResourceManagementResult } from "allotr-graphql-schema-types";
import { MongoDBSingleton } from "../../utils/mongodb-singleton";
import { ObjectId, ReadPreference, WriteConcern, ReadConcern, TransactionOptions } from "mongodb"
import { customTryCatch,  getLastStatus } from "../../utils/data-util";
import { CustomTryCatch } from "../../types/custom-try-catch";

import { canRequestStatusChange } from "../../guards/guards";
import { enqueue, forwardQueue, generateOutputByResource, getResource, pushNotification, notifyFirstInQueue, pushNewStatus, getAwaitingTicket, removeAwaitingConfirmation } from "../../utils/resolver-utils";
import { RESOURCES, USERS } from "../../consts/collections";






export const ResourceResolvers: Resolvers = {
    Query: {
        myResources: async (parent, args, context) => {
            const db = await MongoDBSingleton.getInstance().db;


            const myCurrentTicket = await db.collection<ResourceDbObject>(RESOURCES).find({
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
                creationDate: 1
            }).toArray();

            const resourceList = myCurrentTicket
                .map(({ _id, creationDate, createdBy, lastModificationDate, maxActiveTickets, name, tickets, description, activeUserCount }) => {
                    const myTicket = tickets?.[0];
                    const { statusCode, timestamp: lastStatusTimestamp, queuePosition } = getLastStatus(myTicket);
                    return {
                        activeUserCount,
                        creationDate,
                        createdBy: { userId: createdBy?._id?.toHexString(), username: createdBy?.username ?? "" },
                        lastModificationDate,
                        maxActiveTickets,
                        name,
                        queuePosition,
                        description,
                        lastStatusTimestamp,
                        statusCode: statusCode as TicketStatusCode,
                        role: myTicket.user?.role as LocalRole,
                        ticketId: myTicket._id?.toHexString(),
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
                        await customTryCatch(db.collection<UserDbObject>(USERS).findOne({ _id: new ObjectId(id) }, { projection: { username: 1 } }))
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
            const newResource = {
                creationDate: timestamp,
                lastModificationDate: timestamp,
                maxActiveTickets,
                name,
                description,
                tickets: userList.map(({ id, role }) => ({
                    _id: new ObjectId(),
                    creationDate: timestamp,
                    statuses: [
                        { statusCode: TicketStatusCode.Initialized, timestamp, queuePosition: null }
                    ],
                    user: { role, _id: new ObjectId(id), username: userNameMap?.[id] },
                })),
                createdBy: { _id: context.user._id, username: context.user.username },
                activeUserCount: 0
            }
            const result = await db.collection<ResourceDbObject>(RESOURCES).insertOne(newResource);

            if (result == null) {
                return { status: OperationResult.Error, newObjectId: null };
            }

            return { status: OperationResult.Ok, newObjectId: result.insertedId.toHexString() };
        },
        requestResource: async (parent, args, context) => {
            const { requestFrom, resourceId } = args
            const timestamp = new Date();

            const client = await MongoDBSingleton.getInstance().connection;

            let result: ResourceManagementResult = { status: OperationResult.Ok };

            // Step 1: Start a Client Session
            const session = client.startSession();
            // Step 2: Optional. Define options to use for the transaction
            const transactionOptions: TransactionOptions = {
                readPreference: new ReadPreference(ReadPreference.PRIMARY),
                readConcern: new ReadConcern("local"),
                writeConcern: new WriteConcern("majority")
            };
            // Step 3: Use withTransaction to start a transaction, execute the callback, and commit (or abort on error)
            // Note: The callback for withTransaction MUST be async and/or return a Promise.
            try {
                await session.withTransaction(async () => {
                    // Check if we can request the resource right now
                    const {
                        canRequest,
                        ticketId,
                        activeUserCount = 0,
                        maxActiveTickets = 0,
                        previousStatusCode,
                        lastQueuePosition
                    } = await canRequestStatusChange(context.user._id, resourceId, TicketStatusCode.Requesting, session);

                    if (!canRequest) {
                        result = { status: OperationResult.Error }
                        throw result;
                    }

                    // Change status to requesting
                    await pushNewStatus(resourceId, ticketId, {
                        statusCode: TicketStatusCode.Requesting,
                        timestamp
                    }, 1, session, previousStatusCode);



                    // Here comes the logic to enter the queue or set the status as active
                    if (activeUserCount < maxActiveTickets && (lastQueuePosition === 0)) {
                        await pushNewStatus(resourceId, ticketId, { statusCode: TicketStatusCode.Active, timestamp }, 2, session, TicketStatusCode.Requesting);
                    } else {
                        await enqueue(resourceId, ticketId, timestamp, 2, session);
                    }


                }, transactionOptions);
            } finally {
                await session.endSession();
            }
            if (result.status === OperationResult.Error) {
                return result;
            }


            // Once the session is ended, le't get and return our new data

            const resource = await getResource(resourceId)
            if (resource == null) {
                return { status: OperationResult.Error }
            }

            // Status changed, now let's return the new resource
            return generateOutputByResource[requestFrom](resource, context.user._id, resourceId);
        },
        acquireResource: async (parent, args, context) => {
            const { resourceId } = args
            const timestamp = new Date();

            const client = await MongoDBSingleton.getInstance().connection;

            let result: ResourceManagementResult = { status: OperationResult.Ok };

            // Step 1: Start a Client Session
            const session = client.startSession();
            // Step 2: Optional. Define options to use for the transaction
            const transactionOptions: TransactionOptions = {
                readPreference: new ReadPreference(ReadPreference.PRIMARY),
                readConcern: new ReadConcern("local"),
                writeConcern: new WriteConcern("majority")
            };
            // Step 3: Use withTransaction to start a transaction, execute the callback, and commit (or abort on error)
            // Note: The callback for withTransaction MUST be async and/or return a Promise.
            try {
                await session.withTransaction(async () => {
                    // Check if we can request the resource right now
                    const { canRequest, ticketId, previousStatusCode } = await canRequestStatusChange(context.user._id, resourceId, TicketStatusCode.Active, session);
                    if (!canRequest) {
                        result = { status: OperationResult.Error }
                        throw result;
                    }
                    // Change status to active
                    await removeAwaitingConfirmation(resourceId, timestamp, 1, session)
                }, transactionOptions);
            } finally {
                await session.endSession();
            }

            // // Step 1: Start a Client Session
            const session2 = client.startSession();

            try {
                await session2.withTransaction(async () => {
                    // Check if we can request the resource right now
                    const { canRequest, ticketId, previousStatusCode } = await canRequestStatusChange(context.user._id, resourceId, TicketStatusCode.Active, session2);
                    if (!canRequest) {
                        result = { status: OperationResult.Error }
                        throw result;
                    }
                    // Change status to active
                    // Move people forward in the queue
                    await forwardQueue(resourceId, timestamp, 2, session2);
                    await pushNewStatus(resourceId, ticketId, { statusCode: TicketStatusCode.Active, timestamp }, 3, session2, previousStatusCode);


                }, transactionOptions);
            } finally {
                await session2.endSession();
            }
            if (result.status === OperationResult.Error) {
                return result;
            }

            // Once the session is ended, let's get and return our new data

            const resource = await getResource(resourceId)
            if (resource == null) {
                return { status: OperationResult.Error }
            }

            // Status changed, now let's return the new resource
            return generateOutputByResource["HOME"](resource, context.user._id, resourceId);
        },
        cancelResourceAcquire: async (parent, args, context) => {
            const { resourceId } = args
            const timestamp = new Date();

            const client = await MongoDBSingleton.getInstance().connection;

            let result: ResourceManagementResult = { status: OperationResult.Ok };

            // Step 1: Start a Client Session
            const session = client.startSession();
            // Step 2: Optional. Define options to use for the transaction
            const transactionOptions: TransactionOptions = {
                readPreference: new ReadPreference(ReadPreference.PRIMARY),
                readConcern: new ReadConcern("local"),
                writeConcern: new WriteConcern("majority")
            };
            // Step 3: Use withTransaction to start a transaction, execute the callback, and commit (or abort on error)
            // Note: The callback for withTransaction MUST be async and/or return a Promise.
            try {
                await session.withTransaction(async () => {
                    // Check if we can request the resource right now
                    const { canRequest } = await canRequestStatusChange(context.user._id, resourceId, TicketStatusCode.Inactive, session);
                    if (!canRequest) {
                        result = { status: OperationResult.Error }
                        throw result;
                    }
                    // Remove our awaiting confirmation
                    await removeAwaitingConfirmation(resourceId, timestamp, 1, session)
                }, transactionOptions);
            } finally {
                await session.endSession();
            }

            // // Step 1: Start a Client Session
            const session2 = client.startSession();

            try {
                await session2.withTransaction(async () => {
                    // Check if we can request the resource right now
                    const { canRequest, ticketId, previousStatusCode } = await canRequestStatusChange(context.user._id, resourceId, TicketStatusCode.Queued, session2);
                    if (!canRequest) {
                        result = { status: OperationResult.Error }
                        throw result;
                    }
                    // Change status to active
                    // Move people forward in the queue
                    await forwardQueue(resourceId, timestamp, 2, session2);
                    await pushNewStatus(resourceId, ticketId, { statusCode: TicketStatusCode.Inactive, timestamp }, 3, session2, previousStatusCode);


                }, transactionOptions);
            } finally {
                await session2.endSession();
            }
            if (result.status === OperationResult.Error) {
                return result;
            }

            await notifyFirstInQueue(resourceId, timestamp, 3);

            // Once the session is ended, let's get and return our new data

            const resource = await getResource(resourceId)
            if (resource == null) {
                return { status: OperationResult.Error }
            }

            await pushNotification(resource?.name, resource?._id, resource?.createdBy?._id, resource?.createdBy?.username, timestamp);

            // Status changed, now let's return the new resource
            return generateOutputByResource["HOME"](resource, context.user._id, resourceId);
        },
        releaseResource: async (parent, args, context) => {
            const { requestFrom, resourceId } = args
            const timestamp = new Date();

            const client = await MongoDBSingleton.getInstance().connection;

            let result: ResourceManagementResult = { status: OperationResult.Ok };

            // Step 1: Start a Client Session
            const session = client.startSession();
            // Step 2: Optional. Define options to use for the transaction
            const transactionOptions: TransactionOptions = {
                readPreference: new ReadPreference(ReadPreference.PRIMARY),
                readConcern: new ReadConcern("local"),
                writeConcern: new WriteConcern("majority")
            };
            // Step 3: Use withTransaction to start a transaction, execute the callback, and commit (or abort on error)
            // Note: The callback for withTransaction MUST be async and/or return a Promise.
            try {
                await session.withTransaction(async () => {
                    // Check if we can request the resource right now
                    const { canRequest, ticketId, previousStatusCode } = await canRequestStatusChange(context.user._id, resourceId, TicketStatusCode.Inactive, session);
                    if (!canRequest) {
                        result = { status: OperationResult.Error }
                        throw result;
                    }
                    // Change status to inactive
                    await pushNewStatus(resourceId, ticketId, { statusCode: TicketStatusCode.Inactive, timestamp }, 1, session, previousStatusCode);


                    // Notify our next in queue user
                    await notifyFirstInQueue(resourceId, timestamp, 2, session);
                }, transactionOptions);
            } finally {
                await session.endSession();
            }
            if (result.status === OperationResult.Error) {
                return result;
            }


            // Here comes the notification code


            // Once the session is ended, let's get and return our new data

            const resource = await getResource(resourceId)
            if (resource == null) {
                return { status: OperationResult.Error }
            }

            await pushNotification(resource?.name, resource?._id, resource?.createdBy?._id, resource?.createdBy?.username, timestamp);


            // Status changed, now let's return the new resource
            return generateOutputByResource[requestFrom](resource, context.user._id, resourceId);
        }
    }
}