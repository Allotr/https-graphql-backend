import { IResolvers } from "@graphql-tools/utils";
import { mergeResolvers } from "@graphql-tools/merge";
import { UserResolvers } from "./UserResolvers";
import { ResourceResolvers } from "./ResourceResolvers";
import { NotificationResolvers } from "./NotificationResolvers";

const resolverMap: IResolvers = mergeResolvers([UserResolvers, ResourceResolvers, NotificationResolvers]);
export default resolverMap;


