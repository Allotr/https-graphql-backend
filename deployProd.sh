#!/bin/bash
rm -rf ./template
faas-cli template pull https://github.com/Allotr/openfaas-template-node-typescript-express-amd64
faas-cli deploy -f ./https-graphql-backend-prod.yml
