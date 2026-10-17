# chose images
FROM docker.io/oven/bun:1.4.3-alpine

# set working directory
WORKDIR /app

# copy dependency requirements
COPY package*.json bun*.lock ./

# install dependency
RUN bun install --frozen-lockfile

# copy rest of source code
COPY . .

# expose port 3000
EXPOSE 3000

# running the project
CMD [ "bun", "./src/index.ts" ]
