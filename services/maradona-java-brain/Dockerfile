# ---- BUILD STAGE ----
FROM gradle:9.5.1-jdk21 AS build

WORKDIR /app

# Copia tutto il progetto
COPY . .

# Compila il progetto senza test
RUN gradle clean build -x test --no-daemon

# Debug: lista file generati
RUN echo "=== Files in build/libs ===" && ls -la /app/build/libs/ || echo "build/libs NOT FOUND"

# Fallisci se nessun JAR trovato
RUN if [ ! -f /app/build/libs/maradona-java-brain-0.0.1-SNAPSHOT.jar ]; then \
  echo "ERROR: Expected JAR not found!"; \
  echo "Files in build/libs:"; \
  ls -la /app/build/libs/; \
  exit 1; \
fi

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
