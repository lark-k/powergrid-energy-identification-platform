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
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/models")
@PreAuthorize("hasRole('ADMIN')")
public class ModelRegistryController {
    private final ModelRegistryService service;
    public ModelRegistryController(ModelRegistryService service) { this.service = service; }

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
        service.deploy(version, request.role(), actor.getName());
        return Map.of("model_version", version, "role", request.role(), "status", "deployed");
    }

    @PostMapping("/{task}/rollback")
    public Map<String, Object> rollback(@PathVariable String task, Authentication actor) {
        return Map.of("task", task, "model_version", service.rollback(task, actor.getName()), "status", "rolled_back");
    }

    @PostMapping("/shadow-comparisons")
    public Map<String, Object> shadow(@RequestBody ShadowComparison request, HttpServletRequest servletRequest) {
        service.saveShadowComparison(request, String.valueOf(servletRequest.getAttribute(RequestIdFilter.ATTRIBUTE)));
        return Map.of("status", "saved");
    }
}
