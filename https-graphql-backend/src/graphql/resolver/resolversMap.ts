import { IResolvers } from "@graphql-tools/utils";
import { merge } from "lodash";
import { UserResolvers } from "./UserResolvers";
import { ResourceResolvers } from "./ResourceResolvers";

const resolverMap: IResolvers = merge(UserResolvers, ResourceResolvers);
export default resolverMap;

