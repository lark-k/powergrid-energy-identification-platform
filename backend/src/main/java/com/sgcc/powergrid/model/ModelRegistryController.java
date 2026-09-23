package com.sgcc.powergrid.model;

import com.sgcc.powergrid.common.RequestIdFilter;
import com.sgcc.powergrid.model.ModelRegistryService.DeployRequest;
import com.sgcc.powergrid.model.ModelRegistryService.RegisterRequest;
import com.sgcc.powergrid.model.ModelRegistryService.ShadowComparison;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/models")
@PreAuthorize("hasRole('ADMIN')")
public class ModelRegistryController {
    private final ModelRegistryService service;
    public ModelRegistryController(ModelRegistryService service) { this.service = service; }

    @GetMapping("/available")
    @PreAuthorize("isAuthenticated()")
    public Map<String, Object> available(Authentication actor) {
        var catalog = new java.util.LinkedHashMap<>(service.available());
        catalog.put("can_manage", actor.getAuthorities().stream().anyMatch(a -> a.getAuthority().equals("ROLE_ADMIN")));
        return catalog;
    }

    @PostMapping
    public Map<String, Object> register(@RequestBody RegisterRequest request, Authentication actor) {
        service.register(request, actor.getName());
        return Map.of("model_version", request.modelVersion(), "status", "registered");
    }

    @PostMapping("/{version}/approve")
    public Map<String, Object> approve(@PathVariable String version, Authentication actor) {
        service.approve(version, actor.getName());
        return Map.of("model_version", version, "status", "approved");
    }

    @PostMapping("/{version}/deploy")
    public Map<String, Object> deploy(@PathVariable String version, @RequestBody DeployRequest request, Authentication actor) {
        service.deploy(version, request.role(), actor.getName(), request.expectedVersion());
        return Map.of("model_version", version, "role", request.role(), "status", "deployed");
    }

    @PostMapping("/{task}/rollback")
    public Map<String, Object> rollback(@PathVariable String task, @RequestBody ModelRegistryService.RollbackRequest request, Authentication actor) {
        return Map.of("task", task, "model_version", service.rollback(task, actor.getName(), request.expectedVersion()), "status", "rolled_back");
    }

    @PostMapping("/shadow-comparisons")
    public Map<String, Object> shadow(@RequestBody ShadowComparison request, HttpServletRequest servletRequest) {
        service.saveShadowComparison(request, String.valueOf(servletRequest.getAttribute(RequestIdFilter.ATTRIBUTE)));
        return Map.of("status", "saved");
    }
}
