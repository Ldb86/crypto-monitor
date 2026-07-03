package com.maradona;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class MaradonaApplication {
    public static void main(String[] args) {
        System.out.println("MARADONA Java Brain v0.4.7J-5-final-liquidity-gate-real-tpsl");
        SpringApplication.run(MaradonaApplication.class, args);
    }
}
