import 'graphql-import-node';
import * as userTypeDefs from "allotr-graphql-schema-types/src/schemas/user.graphql"
import { makeExecutableSchema } from "@graphql-tools/schema";
import { DIRECTIVES } from '@graphql-codegen/typescript-mongodb';
import resolvers from "./resolver/resolversMap";
import { GraphQLSchema } from "graphql";

const schema: GraphQLSchema = makeExecutableSchema({
    typeDefs: [DIRECTIVES, userTypeDefs],
    resolvers
});

export default schema;