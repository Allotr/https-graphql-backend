import { Resolvers, OperationResult, ResourceDbObject, UserDbObject, LocalRole, TicketStatusCode, ErrorCode, User, ResourceCard, Ticket } from "allotr-graphql-schema-types";
import { ObjectId, ClientSession, Db } from "mongodb";
import { addMSToTime, getFirstQueuePosition, getLastQueuePosition, getLastStatus } from "../utils/data-util";
import { VALID_STATUES_MAP } from "../consts/valid-statuses-map";
import { getUserTicket, getAwaitingTicket, getResource } from "../utils/resolver-utils";


async function canRequestStatusChange(userId: string | ObjectId, resourceId: string, targetStatus: TicketStatusCode, timestamp: Date, db: Db, session?: ClientSession): Promise<{
    canRequest: boolean,
    ticketId?: ObjectId | null,
    activeUserCount?: number,
    maxActiveTickets?: number,
    queuePosition?: number | null,
    previousStatusCode?: TicketStatusCode,
    lastQueuePosition: number,
    firstQueuePosition: number
}> {
    const resource = await getResource(resourceId, db, session);
    if(new Date(resource?.lastModificationDate ?? "").getTime() > timestamp.getTime()){
        // If race condition, add 1 ms to lastModificationDate
        timestamp = addMSToTime(new Date(resource?.lastModificationDate ?? ""), 1);
    }
    const lastQueuePosition = getLastQueuePosition(resource?.tickets);
    const firstQueuePosition = getFirstQueuePosition(resource?.tickets);
    const userTicket = await getUserTicket(userId, resourceId, db, session);
    const ticket = userTicket?.tickets?.[0];
    const { statusCode, queuePosition } = getLastStatus(ticket);
    return {
        canRequest: userTicket != null && VALID_STATUES_MAP[statusCode as TicketStatusCode].includes(targetStatus),
        ticketId: ticket?._id,
        activeUserCount: userTicket?.activeUserCount,
        maxActiveTickets: userTicket?.maxActiveTickets,
        queuePosition,
        previousStatusCode: statusCode as TicketStatusCode,
        lastQueuePosition,
        firstQueuePosition
    }

}

async function hasUserAccessInResource(userId: string | ObjectId, resourceId: string, db: Db, session?: ClientSession): Promise<boolean> {
    const resource = await getUserTicket(userId, resourceId, db, session);
    return resource?.tickets?.[0]?.user?.role === LocalRole.ResourceUser;
}

async function hasAdminAccessInResource(userId: string | ObjectId, resourceId: string, db: Db, session?: ClientSession): Promise<boolean> {
    const resource = await getUserTicket(userId, resourceId, db, session);
    return resource?.tickets?.[0]?.user?.role === LocalRole.ResourceAdmin;
}



export { hasUserAccessInResource, hasAdminAccessInResource, canRequestStatusChange }