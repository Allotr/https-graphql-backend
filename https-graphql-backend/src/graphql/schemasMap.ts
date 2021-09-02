import 'graphql-import-node';
import * as userTypeDefs from "allotr-graphql-schema-types/src/schemas/user.graphql"
import * as resourceTypeDefs from "allotr-graphql-schema-types/src/schemas/resource.graphql"
import * as resourceNotification from "allotr-graphql-schema-types/src/schemas/resourceNotification.graphql"
import { makeExecutableSchema } from "@graphql-tools/schema";
import { DIRECTIVES } from '@graphql-codegen/typescript-mongodb';
import resolvers from "./resolvers/ResolversMap";
import { GraphQLSchema } from "graphql";

const schema: GraphQLSchema = makeExecutableSchema({
    typeDefs: [DIRECTIVES, userTypeDefs, resourceTypeDefs, resourceNotification],
    resolvers
});

export default schema;