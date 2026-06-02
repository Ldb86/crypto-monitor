FROM eclipse-temurin:21-jdk

WORKDIR /app

COPY . .

RUN ./gradlew clean build -x test --no-daemon

# Railway espone PORT come variabile d'ambiente
ENV PORT=8080

EXPOSE 8080

CMD ["java", "-jar", "build/libs/maradona-java-brain-0.0.1-SNAPSHOT.jar"]
