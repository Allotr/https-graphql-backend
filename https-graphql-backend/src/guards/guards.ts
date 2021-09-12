import { Resolvers, OperationResult, ResourceDbObject, UserDbObject, LocalRole, TicketStatusCode, ErrorCode, User, ResourceCard, Ticket } from "allotr-graphql-schema-types";
import { MongoDBSingleton } from "../utils/mongodb-singleton";
import { ObjectId, ClientSession, Db } from "mongodb";
import { getFirstQueuePosition, getLastQueuePosition, getLastStatus } from "../utils/data-util";
import { VALID_STATUES_MAP } from "../consts/valid-statuses-map";
import { getUserTicket, getAwaitingTicket, getResource } from "../utils/resolver-utils";


async function canRequestStatusChange(userId: string | ObjectId, resourceId: string, targetStatus: TicketStatusCode, session: ClientSession, myDb?: Db): Promise<{
    canRequest: boolean,
    ticketId?: ObjectId | null,
    activeUserCount?: number,
    maxActiveTickets?: number,
    queuePosition?: number | null,
    previousStatusCode?: TicketStatusCode,
    lastQueuePosition: number,
    firstQueuePosition: number
}> {
    const resource = await getResource(resourceId);
    const lastQueuePosition = getLastQueuePosition(resource?.tickets);
    const firstQueuePosition = getFirstQueuePosition(resource?.tickets);
    const userTicket = await getUserTicket(userId, resourceId, myDb);
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

async function hasUserAccessInResource(userId: string | ObjectId, resourceId: string): Promise<boolean> {
    const resource = await getUserTicket(userId, resourceId);
    return resource?.tickets?.[0]?.user?.role === LocalRole.ResourceUser;
}

async function hasAdminAccessInResource(userId: string | ObjectId, resourceId: string): Promise<boolean> {
    const resource = await getUserTicket(userId, resourceId);
    return resource?.tickets?.[0]?.user?.role === LocalRole.ResourceAdmin;
}



export { hasUserAccessInResource, hasAdminAccessInResource, canRequestStatusChange }