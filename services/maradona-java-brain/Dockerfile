# ---- BUILD STAGE ----
FROM eclipse-temurin:21-jdk AS build

WORKDIR /app

# Copia tutto il progetto
COPY . .

# Rende eseguibile gradlew
RUN chmod +x gradlew

# Compila il progetto senza test
RUN ./gradlew clean build -x test --no-daemon

# ---- RUNTIME STAGE ----
FROM eclipse-temurin:21-jdk

WORKDIR /app

# Copia il JAR generato e rinominalo in app.jar
COPY --from=build /app/build/libs/*.jar app.jar

# Railway usa la variabile PORT
ENV PORT=8080
EXPOSE 8080

# Avvia l'app
CMD ["java", "-jar", "app.jar"]
