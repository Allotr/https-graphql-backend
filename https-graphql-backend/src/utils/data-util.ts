import { CustomTryCatch } from "src/types/custom-try-catch";

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

export { customTryCatch, compareDates }