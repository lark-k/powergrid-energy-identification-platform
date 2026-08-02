package com.sgcc.powergrid.security;

import com.sgcc.powergrid.common.PlatformProperties;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
@EnableMethodSecurity
public class SecurityConfiguration {
    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, PlatformProperties properties,
            SecurityErrorWriter securityErrorWriter) throws Exception {
        http.csrf(csrf -> csrf.disable())
                .cors(Customizer.withDefaults())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .headers(headers -> headers
                        .contentTypeOptions(Customizer.withDefaults())
                        .frameOptions(frame -> frame.deny())
                        .referrerPolicy(referrer -> referrer.policy(
                                org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER)))
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint(securityErrorWriter)
                        .accessDeniedHandler(securityErrorWriter))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/actuator/health/**").permitAll()
                        .requestMatchers("/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.POST, "/api/v1/ingestion/**").hasAnyRole("ADMIN", "OPERATOR")
                        .requestMatchers(HttpMethod.POST, "/api/v1/stations/*/inference-replays").hasAnyRole("ADMIN", "OPERATOR")
                        .requestMatchers(HttpMethod.POST, "/api/v1/imports", "/api/v1/exports").hasAnyRole("ADMIN", "OPERATOR")
                        .anyRequest().authenticated());

        if ("dev".equalsIgnoreCase(properties.security().mode())) {
            http.addFilterBefore(new DevAuthenticationFilter(), BearerTokenAuthenticationFilter.class);
        } else {
            http.oauth2ResourceServer(resource -> resource
                    .bearerTokenResolver(new WebSocketBearerTokenResolver())
                    .jwt(Customizer.withDefaults()));
        }
        return http.build();
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(PlatformProperties properties) {
        CorsConfiguration configuration = new CorsConfiguration();
        List<String> origins = properties.security().corsAllowedOrigins();
        configuration.setAllowedOrigins(origins == null ? List.of() : origins.stream()
                .filter(value -> value != null && !value.isBlank()).toList());
        configuration.setAllowedMethods(List.of("GET", "POST", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Request-ID", "X-Dev-User", "X-Dev-Roles"));
        configuration.setExposedHeaders(List.of("X-Request-ID"));
        configuration.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
