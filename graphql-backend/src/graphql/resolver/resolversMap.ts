import { IResolvers } from "graphql-tools";
import { merge } from "lodash";
import { UserResolvers } from "./UserResolvers";

const resolverMap: IResolvers = merge(UserResolvers);
export default resolverMap;

