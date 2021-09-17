import { Resolvers, OperationResult, ResourceDbObject, UserDbObject, LocalRole, TicketStatusCode, ErrorCode, User, ResourceCard, Ticket, RequestSource, ResourceManagementResult, ResourceNotification, ResourceNotificationDbObject, WebPushSubscription, Resource, ResourceUser } from "allotr-graphql-schema-types";
import { MongoDBSingleton } from "./mongodb-singleton";
import { ObjectId, ClientSession, Db } from "mongodb";
import { addMSToTime, generateChannelId, getLastQueuePosition, getLastStatus } from "./data-util";
import { NOTIFICATIONS, RESOURCES, USERS } from "../consts/collections";
import { sendNotification } from "../notifications/web-push";
import { RESOURCE_READY_TO_PICK } from "../consts/connection-tokens";
import { RedisSingleton } from "./redis-singleton";
import { VALID_STATUES_MAP } from "src/consts/valid-statuses-map";
async function getUserTicket(userId: string | ObjectId, resourceId: string, myDb?: Db): Promise<ResourceDbObject | null> {
    const db = myDb ?? await (await MongoDBSingleton.getInstance()).db;
    const [parsedUserId, parsedResourceId] = [new ObjectId(userId), new ObjectId(resourceId)];

    const [userTikcet] = await db.collection<ResourceDbObject>(RESOURCES).find({
        _id: parsedResourceId,
        "tickets.user._id": parsedUserId,
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
        lastModificationDate: -1
    }).toArray();

    return userTikcet;
}

async function getResource(resourceId: string): Promise<ResourceDbObject | null | undefined> {
    const db = await (await MongoDBSingleton.getInstance()).db;

    const userTikcet = await db.collection<ResourceDbObject>(RESOURCES).findOne({
        _id: new ObjectId(resourceId),
        "tickets.statuses.statusCode": {
            $ne: TicketStatusCode.Revoked
        }
    });

    return userTikcet;
}

async function getAwaitingTicket(resourceId: string): Promise<ResourceDbObject | null> {
    const db = await (await MongoDBSingleton.getInstance()).db;
    const parsedResourceId = new ObjectId(resourceId);
    const [userTikcet] = await db.collection<ResourceDbObject>(RESOURCES).find({
        _id: parsedResourceId,
        "tickets.statuses.statusCode": TicketStatusCode.AwaitingConfirmation
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
        lastModificationDate: -1
    }).toArray();

    return userTikcet;
}


async function getUser(userId?: ObjectId | null): Promise<UserDbObject | null | undefined> {
    const db = await (await MongoDBSingleton.getInstance()).db;
    const userTikcet = await db.collection<UserDbObject>(USERS).findOne({
        _id: userId,
    })

    return userTikcet;
}



// Resource Utils
async function pushNewStatus(
    resourceId: string,
    ticketId: ObjectId | undefined | null,
    {
        statusCode,
        timestamp,
        queuePosition
    }: {
        statusCode: TicketStatusCode,
        timestamp: Date,
        queuePosition?: number
    },
    executionPosition: number,
    session: ClientSession,
    previousStatus?: TicketStatusCode) {

    const db = await (await MongoDBSingleton.getInstance()).db;
    // Add 1ms to make sure the statuses are in order
    const newTimestamp = addMSToTime(timestamp, executionPosition)

    const increment: Record<TicketStatusCode, number> = {
        ACTIVE: 1,
        INACTIVE: previousStatus === TicketStatusCode.Active ? -1 : 0,
        AWAITING_CONFIRMATION: 0,
        INITIALIZED: 0,
        QUEUED: 0,
        REQUESTING: 0,
        REVOKED: 0
    }

    await db.collection(RESOURCES).updateOne({ _id: new ObjectId(resourceId) }, {
        $inc: {
            activeUserCount: increment[statusCode]
        },
        $set: {
            lastModificationDate: newTimestamp
        },
        $push: {
            "tickets.$[myTicket].statuses": { statusCode, timestamp: newTimestamp, queuePosition }
        }
    }, {
        session,
        arrayFilters: [
            {
                "myTicket._id": ticketId
            },
        ],
    })

}

async function enqueue(
    resourceId: string,
    ticketId: ObjectId | undefined | null,
    currentDate: Date,
    executionPosition: number,
    session: ClientSession
) {
    const resource = await getResource(resourceId)
    const db = await (await MongoDBSingleton.getInstance()).db;
    const timestamp = addMSToTime(currentDate, executionPosition)

    await db.collection(RESOURCES).updateOne({ _id: new ObjectId(resourceId) }, {
        $set: {
            lastModificationDate: currentDate
        },
        $push: {
            "tickets.$[myTicket].statuses": {
                statusCode: TicketStatusCode.Queued,
                timestamp,
                queuePosition: getLastQueuePosition(resource?.tickets) + 1
            }
        }
    }, {
        session,
        arrayFilters: [
            {
                "myTicket._id": ticketId
            },
        ],
    })
}

async function forwardQueue(
    resourceId: string,
    currentDate: Date,
    executionPosition: number,
    session: ClientSession,
    myDb?: Db
) {
    const db = myDb ?? await (await MongoDBSingleton.getInstance()).db;
    const timestamp = addMSToTime(currentDate, executionPosition)

    await db.collection(RESOURCES).updateOne({
        _id: new ObjectId(resourceId)
    }, {
        $set: {
            lastModificationDate: timestamp,
            "tickets.$[].statuses.$[myStatus].timestamp": timestamp
        },
        $inc: {
            activeUserCount: 0,
            "tickets.$[].statuses.$[myStatus].queuePosition": -1
        }
    }, {
        session,
        arrayFilters: [
            {
                "myStatus.queuePosition": { $nin: [null, 0] }
            },
        ],
    })
}

async function removeUsersInQueue(resource: ResourceDbObject, userList: ResourceUser[], currentDate: Date,
    executionPosition: number, session?: ClientSession) {
    const db = await (await MongoDBSingleton.getInstance()).db;
    const timestamp = addMSToTime(currentDate, executionPosition)
    const deletionUsersQueuePosition = userList
        .map<number>(
            ({ id }) => {
                const myTicket = resource.tickets.find(({ user }) => new ObjectId(user._id ?? "").equals(id));
                if (myTicket == null) {
                    return -1;
                }
                const queuedStatus = myTicket.statuses.find(({ statusCode }) => statusCode === TicketStatusCode.Queued);
                if (queuedStatus == null) {
                    return -1;
                }
                return queuedStatus.queuePosition ?? -1;
            }
        )
        .filter(value => value !== -1)
        .sort();
    console.log("REMOVE USERS IN QUEUEEEEEEEEEEEE", { deletionUsersQueuePosition })
    for (let index = 0; index < deletionUsersQueuePosition.length; index++) {
        const queuePosition = deletionUsersQueuePosition[index];
        const nextQueuePosition = deletionUsersQueuePosition?.[index + 1] ?? deletionUsersQueuePosition.length + 1;
        console.log({ queuePosition, nextQueuePosition });
        await db.collection(RESOURCES).updateOne({
            _id: new ObjectId(resource._id ?? ""),
        }, {
            $set: {
                lastModificationDate: timestamp,
                "tickets.$[].statuses.$[myStatus].timestamp": timestamp
            },
            $inc: {
                "tickets.$[].statuses.$[myStatus].queuePosition": -1
            }
        }, {
            session,
            arrayFilters: [
                {
                    "myStatus.queuePosition": { $elemMatch: { $gt: queuePosition, $lt: nextQueuePosition + 1 } }
                },
            ],
        })
    }
    // Delete notifications
    await db.collection<ResourceNotificationDbObject>(NOTIFICATIONS).deleteMany({
        "resource._id": new ObjectId(resource._id ?? ""),
        "user._id": {
            $in: [...userList?.map(({ id }) => !!id ? new ObjectId(id) : null).filter(Boolean)]
        }
    })


    await db.collection<ResourceDbObject>(RESOURCES).updateMany({
        _id: new ObjectId(resource._id ?? ""),
    }, {
        $pull: {
            tickets: {
                "user._id": { $in: [...userList?.map(({ id }) => !!id ? new ObjectId(id) : null).filter(Boolean)] }
            }
        } as any
    }, {
        session
    })
}

async function removeAwaitingConfirmation(
    resourceId: string,
    firstQueuePosition: number,
    session: ClientSession) {
    const db = await (await MongoDBSingleton.getInstance()).db;
    // Delete notification
    const userId = (await getAwaitingTicket(resourceId))?.tickets?.[0].user?._id;
    await db.collection<ResourceNotificationDbObject>(NOTIFICATIONS).deleteOne(
        {
            "resource._id": new ObjectId(resourceId),
            "user._id": userId
        }, {
        session
    })

    const result = await db.collection<ResourceDbObject>(RESOURCES).updateMany({
        _id: new ObjectId(resourceId),
        "tickets.statuses.statusCode": TicketStatusCode.AwaitingConfirmation
    }, {
        $pull: {
            "tickets.$[myTicket].statuses": { $or: [{ statusCode: TicketStatusCode.AwaitingConfirmation }, { statusCode: TicketStatusCode.Queued, queuePosition: firstQueuePosition }] }
        }
    }, {
        session,
        arrayFilters: [
            {
                "myTicket.statuses.statusCode": TicketStatusCode.AwaitingConfirmation
            },
        ],
    })
}

async function notifyFirstInQueue(
    resourceId: string,
    currentDate: Date,
    executionPosition: number,
    firstQueuePosition: number,
    session?: ClientSession) {
    const db = await (await MongoDBSingleton.getInstance()).db;
    // Add 1ms to make sure the statuses are in order
    const timestamp = addMSToTime(currentDate, executionPosition)
    await db.collection(RESOURCES).updateOne({
        _id: new ObjectId(resourceId),
        "tickets.statuses.queuePosition": firstQueuePosition
    }, {
        $push: {
            "tickets.$[myTicket].statuses": { statusCode: TicketStatusCode.AwaitingConfirmation, timestamp, queuePosition: firstQueuePosition }
        }
    }, {
        session,
        arrayFilters: [
            {
                "myTicket.statuses.queuePosition": firstQueuePosition
            },
        ],
    })
}


const generateOutputByResource: Record<RequestSource, (resource: ResourceDbObject, userId: ObjectId, resourceId: string) => ResourceManagementResult> = {
    HOME: ({ activeUserCount, creationDate, createdBy, lastModificationDate, name, description, tickets, maxActiveTickets }, userId, resourceId) => {
        const myTicket = tickets?.[0];
        const { statusCode, timestamp: lastStatusTimestamp, queuePosition } = getLastStatus(tickets.find(({ user }) => user._id?.equals(userId)));
        return {
            status: OperationResult.Ok,
            updatedResourceCard: {
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
                resourceId
            }
        }
    },
    RESOURCE: (resource) => ({
        status: OperationResult.Ok,
        // TO BE IMPLEMENTED WHEN VIEW IS READY
        // updatedResourceView: {

        // }
    }),
}



async function pushNotification(resourceName: string, resourceId: ObjectId | null | undefined,
    createdByUserId: ObjectId | null | undefined, createdByUsername: string | undefined, timestamp: Date) {
    const db = await (await MongoDBSingleton.getInstance()).db;

    // let's notify all the WebPush links associated with the user
    const resource = await getAwaitingTicket(resourceId?.toHexString() ?? "");
    const ticket = resource?.tickets[0];
    const user = ticket?.user;

    // Now we insert the record
    if (user?._id == null) {
        return;
    }

    const notificationData = {
        _id: new ObjectId(),
        ticketStatus: TicketStatusCode.AwaitingConfirmation,
        user: { username: user?.username ?? "", _id: user?._id },
        titleRef: "ResourceAvailableNotification",
        descriptionRef: "ResourceAvailableDescriptionNotification",
        resource: { _id: resourceId, name: resourceName, createdBy: { _id: createdByUserId, username: createdByUsername ?? "" } },
        timestamp
    };
    await db.collection<ResourceNotificationDbObject>(NOTIFICATIONS).insertOne(notificationData);

    // Finally, we obtain the destined user subscriptions
    const fullReceivingUser = await getUser(user?._id);
    if (fullReceivingUser == null) {
        return;
    }

    fullReceivingUser?.webPushSubscriptions?.forEach(subscription => {
        if (subscription == null) {
            return;
        }
        sendNotification({ endpoint: subscription.endpoint ?? "", keys: { auth: subscription.keys?.auth ?? "", p256dh: subscription.keys?.p256dh ?? "" } })
    })

    RedisSingleton.getInstance().pubsub.publish(generateChannelId(RESOURCE_READY_TO_PICK, user?._id), {
        myNotificationDataSub: [
            {
                ticketStatus: notificationData.ticketStatus as TicketStatusCode,
                user: { username: notificationData.user.username, id: notificationData.user._id.toHexString() },
                descriptionRef: notificationData.descriptionRef,
                id: notificationData._id?.toHexString(),
                resource: {
                    id: notificationData.resource?._id as any, name: notificationData.resource?.name ?? "", createdBy: {
                        username: notificationData.resource?.createdBy?.username ?? "",
                        id: notificationData.resource?.createdBy?._id as any
                    }
                },
                timestamp: notificationData.timestamp,
                titleRef: notificationData.titleRef
            }
        ]
    })

}

export { getUserTicket, getResource, pushNewStatus, enqueue, forwardQueue, notifyFirstInQueue, generateOutputByResource, pushNotification, getAwaitingTicket, removeAwaitingConfirmation, removeUsersInQueue }