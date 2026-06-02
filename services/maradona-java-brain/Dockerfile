FROM gradle:8.7-jdk17 AS build

WORKDIR /app

COPY . .

RUN gradle clean build -x test

FROM eclipse-temurin:17-jre

WORKDIR /app

COPY --from=build /app/build/libs/*.jar app.jar

ENV PORT=3000
EXPOSE 3000

CMD ["java", "-jar", "app.jar"]