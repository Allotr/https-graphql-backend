import { IResolvers } from "@graphql-tools/utils";
import { merge } from "lodash";
import { UserResolvers } from "./UserResolvers";
import { ResourceResolvers } from "./ResourceResolvers";
import { NotificationResolvers } from "./NotificationResolvers";

const resolverMap: IResolvers = merge(UserResolvers, ResourceResolvers, NotificationResolvers);
export default resolverMap;


