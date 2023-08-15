import { CustomTryCatch } from "../types/custom-try-catch";
import { TicketDbObject, TicketStatusCode, TicketStatusDbObject } from "allotr-graphql-schema-types";
import { ObjectId } from "mongodb";
import { CategorizedArrayData } from "../types/categorized-array-data";

async function customTryCatch<T>(promise: Promise<T>): Promise<CustomTryCatch<T>> {
    try {
        const result = await promise;
        return { result, error: null }
    } catch (error) {
        return { result: null, error }
    }
}

function compareDates(dateA: Date, dateB: Date) {
    const comparison = new Date(dateA).getTime() - new Date(dateB).getTime();
    if (comparison > 0)
        return 1;
    if (comparison < 0)
        return -1;
    return 0;
}

function generateChannelId(communicationToken: string, userId?: ObjectId | null): string {
    return communicationToken + "_" + (userId ? new ObjectId(userId).toHexString() : "")
}

function addMSToTime(date: Date, extraMS: number): Date {
    // const newDate = date;
    // newDate.setMilliseconds(newDate.getMilliseconds() + extraMS)
    // return newDate;
    return date;
}

function getLastStatus(myTicket?: TicketDbObject): TicketStatusDbObject {
    return myTicket?.statuses[myTicket?.statuses.length - 1] ?? {
        statusCode: TicketStatusCode.Initialized,
        timestamp: new Date(),
        queuePosition: null
    };
}

function getLastQueuePosition(tickets: TicketDbObject[] | undefined = []): number {
    return tickets.reduce<number>((lastPosition, ticket) => {
        const { queuePosition } = getLastStatus(ticket);
        const processedQueuePosition = queuePosition ?? 0;
        return lastPosition > processedQueuePosition ? lastPosition : processedQueuePosition;
    }, 0) ?? 0;
}

function getFirstQueuePosition(tickets: TicketDbObject[] | undefined = []): number {
    return tickets.reduce<number>((firstPosition, ticket) => {
        const { queuePosition } = getLastStatus(ticket);
        const processedQueuePosition = queuePosition ?? Number.MAX_SAFE_INTEGER;
        return firstPosition < processedQueuePosition ? firstPosition : processedQueuePosition;
    }, Number.MAX_SAFE_INTEGER) ?? 1;
}

function categorizeArrayData<T extends { id: string }>(previousList: T[], newList: T[]): CategorizedArrayData<T> {
    const newListCopy = [...newList];
    const total: CategorizedArrayData<T> = {
        add: [],
        delete: [],
        modify: []
    }

    for (const previousData of previousList) {
        const indexInNewList = newListCopy.findIndex(({ id }) => id === previousData.id);
        if (indexInNewList !== -1) {
            // If found, we modify
            total.modify.push({ ...previousData, ...newListCopy[indexInNewList] })
            // And we remove the found value from the new list
            newListCopy.splice(indexInNewList, 1);
        } else {
            // If not found, we delete
            total.delete.push(previousData)
        }
    }
    // The rest is added
    total.add = newListCopy;
    return total;
}

export { customTryCatch, compareDates, generateChannelId, getLastStatus, getLastQueuePosition, addMSToTime, categorizeArrayData, getFirstQueuePosition }