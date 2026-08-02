package com.sgcc.powergrid.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

public class DevAuthenticationFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        String user = request.getHeader("X-Dev-User");
        if (user == null || user.isBlank()) {
            user = "dev-operator";
        }
        String rolesHeader = request.getHeader("X-Dev-Roles");
        List<SimpleGrantedAuthority> authorities = Arrays.stream(
                        rolesHeader == null || rolesHeader.isBlank() ? new String[] {"ADMIN"} : rolesHeader.split(","))
                .map(String::trim)
                .filter(role -> role.matches("[A-Z_]{2,32}"))
                .map(role -> new SimpleGrantedAuthority("ROLE_" + role))
                .toList();
        SecurityContextHolder.getContext().setAuthentication(
                UsernamePasswordAuthenticationToken.authenticated(user, "N/A", authorities));
        filterChain.doFilter(request, response);
    }
}
