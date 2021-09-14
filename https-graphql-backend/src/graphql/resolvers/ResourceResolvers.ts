
import { Resolvers, OperationResult, ResourceDbObject, UserDbObject, LocalRole, TicketStatusCode, ErrorCode, ResourceManagementResult, TicketViewUserInfo, TicketView, TicketStatus, ResourceUser, UpdateResult, ResourceNotificationDbObject } from "allotr-graphql-schema-types";
import { MongoDBSingleton } from "../../utils/mongodb-singleton";
import { ObjectId, ReadPreference, WriteConcern, ReadConcern, TransactionOptions } from "mongodb"
import { categorizeArrayData, customTryCatch, getFirstQueuePosition, getLastStatus } from "../../utils/data-util";
import { CustomTryCatch } from "../../types/custom-try-catch";
import { canRequestStatusChange, hasAdminAccessInResource } from "../../guards/guards";
import { enqueue, forwardQueue, generateOutputByResource, getResource, pushNotification, notifyFirstInQueue, pushNewStatus, removeAwaitingConfirmation } from "../../utils/resolver-utils";
import { NOTIFICATIONS, RESOURCES, USERS } from "../../consts/collections";


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
        },
        viewResource: async (parent, args, context) => {

            const { resourceId } = args;
            const db = await MongoDBSingleton.getInstance().db;
            const myResource = await db.collection<ResourceDbObject>(RESOURCES).findOne({
                _id: new ObjectId(resourceId)
            });

            if (myResource == null) {
                return null;
            }

            const tickets = myResource.tickets;

            if (tickets.findIndex(({ user }) => user._id?.equals(context.user._id)) === -1) {
                return null;
            }

            const userDataMap: Record<string, TicketViewUserInfo> = {};
            const userIdList = tickets.map(({ user }) => user._id);

            const userDataList = await db.collection<UserDbObject>(USERS).find(
                {
                    _id: { $in: userIdList }
                }, {
                projection: {
                    _id: 1,
                    username: 1,
                    name: 1,
                    surname: 1
                }
            }).toArray();

            if (userDataList == null) {
                return null;
            }

            for (const user of userDataList) {
                userDataMap[user._id?.toHexString() ?? ""] = {
                    ...userDataMap[user._id?.toHexString() ?? ""],
                    userId: user._id?.toHexString(),
                    name: user.name ?? "",
                    surname: user.surname ?? "",
                    username: user.username ?? "",
                }
            }
            // Add the role to the map
            for (const { user } of tickets) {
                userDataMap[user._id?.toHexString() ?? ""] = { ...userDataMap[user._id?.toHexString() ?? ""], role: user.role as LocalRole }
            }

            const ticketList = tickets.map<TicketView>(ticket => {
                const { creationDate, user, _id } = ticket;
                return {
                    ticketId: _id?.toHexString(),
                    creationDate,
                    user: userDataMap[user._id?.toHexString() ?? ""],
                    lastStatus: getLastStatus(ticket) as TicketStatus
                }
            }).filter(({ lastStatus }) => {
                return [TicketStatusCode.Requesting, TicketStatusCode.Revoked].every(code => code !== lastStatus.statusCode)
            });

            const filteredTicketList = [
                ...ticketList.filter(({ lastStatus }) => lastStatus.statusCode === TicketStatusCode.Active),
                ...ticketList.filter(({ lastStatus }) => lastStatus.statusCode === TicketStatusCode.AwaitingConfirmation),
                ...ticketList.filter(({ lastStatus }) => lastStatus.statusCode === TicketStatusCode.Queued).sort((a, b) =>
                    (a.lastStatus.queuePosition ?? 0) - (b.lastStatus.queuePosition ?? 0)
                ),
                ...ticketList.filter(({ lastStatus }) => [TicketStatusCode.Inactive, TicketStatusCode.Initialized].includes(lastStatus.statusCode)),
            ]

            return {
                id: resourceId,
                activeUserCount: myResource.activeUserCount,
                creationDate: myResource.creationDate,
                lastModificationDate: myResource.lastModificationDate,
                maxActiveTickets: myResource.maxActiveTickets,
                name: myResource.name,
                description: myResource.description ?? "",
                createdBy: { username: myResource.createdBy?.username ?? "", userId: myResource.createdBy?._id?.toHexString() ?? "" },
                tickets: filteredTicketList
            };
        }
    },
    Mutation: {
        // Resource CRUD operations
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
        updateResource: async (parent, args, context) => {
            const { name, description, maxActiveTickets, userList: newUserList, id } = args.resource
            const timestamp = new Date();

            const db = await MongoDBSingleton.getInstance().db;

            const client = await MongoDBSingleton.getInstance().connection;

            let result: UpdateResult = { status: OperationResult.Ok };


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
                    const userNameList = newUserList
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

                    const resource = await getResource(id ?? "")
                    if (resource == null) {
                        return { status: OperationResult.Error }
                    }

                    const oldUserList = resource?.tickets?.map<ResourceUser>(({ user }) => ({ id: user._id?.toHexString() ?? "", role: user.role as LocalRole }))

                    const categorizedUserData = categorizeArrayData(oldUserList, newUserList);

                    // Update
                    await db.collection<ResourceDbObject>(RESOURCES).updateMany({
                        _id: new ObjectId(id ?? ""),
                    }, {
                        $push: {
                            tickets: {
                                $each: categorizedUserData.add.map(({ id, role }) => {
                                    return {
                                        _id: new ObjectId(),
                                        creationDate: timestamp,
                                        statuses: [
                                            { statusCode: TicketStatusCode.Initialized, timestamp, queuePosition: null }
                                        ],
                                        user: { role, _id: new ObjectId(id), username: userNameMap?.[id] }
                                    }
                                })

                            }
                        }
                    }, {
                        session
                    })

                    // Delete notifications
                    await db.collection<ResourceNotificationDbObject>(NOTIFICATIONS).deleteMany({
                        "resource._id": new ObjectId(id ?? ""),
                        "user._id": {
                            $in: [...categorizedUserData.delete?.map(({ id }) => !!id ? new ObjectId(id) : null).filter(Boolean)]
                        }
                    })

                    await db.collection<ResourceDbObject>(RESOURCES).updateMany({
                        _id: new ObjectId(id ?? ""),
                    }, {
                        $pull: {
                            tickets: {
                                "user._id": { $in: [...categorizedUserData.delete?.map(({ id }) => !!id ? new ObjectId(id) : null).filter(Boolean)] }
                            }
                        } as any
                    }, {
                        session
                    })

                    for (const { id: ticketUserId, role } of categorizedUserData.modify) {
                        await db.collection<ResourceDbObject>(RESOURCES).updateMany({
                            _id: new ObjectId(id ?? ""),
                            "tickets.user._id": new ObjectId(ticketUserId)
                        }, {
                            $set: {
                                "tickets.$[toModifyTicket].user.role": role
                            }

                        }, {
                            session,
                            arrayFilters: [
                                {
                                    "toModifyTicket.user._id": new ObjectId(ticketUserId)
                                },
                            ],
                        })

                    }

                    // Find all results
                    await db.collection<ResourceDbObject>(RESOURCES).updateMany({
                        _id: new ObjectId(id ?? "")
                    }, {
                        $set: {
                            lastModificationDate: timestamp,
                            maxActiveTickets,
                            name,
                            description
                        }
                    }, {
                        session
                    });

                    if (result == null) {
                        return { status: OperationResult.Error, newObjectId: null };
                    }
                }, transactionOptions);
            } finally {
                await session.endSession();
            }
            if (result.status === OperationResult.Error) {
                return result;
            }


            return { status: OperationResult.Ok };
        },
        deleteResource: async (parent, args, context) => {
            const { resourceId } = args
            const db = await MongoDBSingleton.getInstance().db;

            const hasAdminAccess = await hasAdminAccessInResource(context.user._id.toHexString() ?? "", resourceId)
            if (!hasAdminAccess) {
                console.log("Does not have admin access", hasAdminAccess, context.user._id, resourceId);
                return { status: OperationResult.Error }
            }

            const deleteResult = await db.collection<ResourceDbObject>(RESOURCES).deleteOne({ _id: new ObjectId(resourceId) })

            if (!deleteResult.deletedCount) {
                console.log("Has not deleted the resource");
                return { status: OperationResult.Error }
            }
            return { status: OperationResult.Ok };
        },

        // Resource management operations
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
                        lastQueuePosition,
                        firstQueuePosition
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
                    const { canRequest, ticketId, previousStatusCode, firstQueuePosition } = await canRequestStatusChange(context.user._id, resourceId, TicketStatusCode.Active, session);
                    if (!canRequest) {
                        result = { status: OperationResult.Error }
                        throw result;
                    }
                    // Change status to active
                    await removeAwaitingConfirmation(resourceId, firstQueuePosition, session)
                }, transactionOptions);
            } finally {
                await session.endSession();
            }

            // // Step 1: Start a Client Session
            const session2 = client.startSession();

            try {
                await session2.withTransaction(async () => {
                    // Check if we can request the resource right now
                    const { canRequest, ticketId, previousStatusCode, firstQueuePosition } = await canRequestStatusChange(context.user._id, resourceId, TicketStatusCode.Active, session2);
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
                    const { canRequest, firstQueuePosition } = await canRequestStatusChange(context.user._id, resourceId, TicketStatusCode.Inactive, session);
                    if (!canRequest) {
                        result = { status: OperationResult.Error }
                        throw result;
                    }
                    // Remove our awaiting confirmation
                    await removeAwaitingConfirmation(resourceId, firstQueuePosition, session)
                }, transactionOptions);
            } finally {
                await session.endSession();
            }

            // // Step 1: Start a Client Session
            const session2 = client.startSession();

            try {
                await session2.withTransaction(async () => {
                    // Check if we can request the resource right now
                    const { canRequest, ticketId, previousStatusCode, firstQueuePosition } = await canRequestStatusChange(context.user._id, resourceId, TicketStatusCode.Queued, session2);
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

            // Once the session is ended, let's get and return our new data

            const resource = await getResource(resourceId)
            if (resource == null) {
                return { status: OperationResult.Error }
            }

            const firstQueuePosition = getFirstQueuePosition(resource?.tickets ?? []);
            await notifyFirstInQueue(resourceId, timestamp, 3, firstQueuePosition);

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
                    const { canRequest, ticketId, previousStatusCode, firstQueuePosition } = await canRequestStatusChange(context.user._id, resourceId, TicketStatusCode.Inactive, session);
                    if (!canRequest) {
                        result = { status: OperationResult.Error }
                        throw result;
                    }
                    // Change status to inactive
                    await pushNewStatus(resourceId, ticketId, { statusCode: TicketStatusCode.Inactive, timestamp }, 1, session, previousStatusCode);


                    // Notify our next in queue user
                    await notifyFirstInQueue(resourceId, timestamp, 2, firstQueuePosition, session);
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