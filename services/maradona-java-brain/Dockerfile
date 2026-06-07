FROM gradle:8.10-jdk21 AS build

WORKDIR /app

COPY . .

RUN gradle clean build --no-daemon

FROM eclipse-temurin:21-jre

WORKDIR /app

COPY --from=build /app/build/libs/*.jar app.jar

EXPOSE 3000
ENV PORT=3000

CMD ["java","-jar","app.jar"]