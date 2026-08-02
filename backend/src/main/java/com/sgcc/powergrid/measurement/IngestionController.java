package com.sgcc.powergrid.measurement;

import com.sgcc.powergrid.common.RequestIdFilter;
import com.sgcc.powergrid.measurement.IngestionModels.Receipt;
import com.sgcc.powergrid.measurement.IngestionModels.Request;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/ingestion/main-switch/minutes")
public class IngestionController {
    private final IngestionService service;

    public IngestionController(IngestionService service) {
        this.service = service;
    }

    @PostMapping
    public ResponseEntity<Receipt> ingest(
            @Valid @RequestBody Request body,
            @RequestParam(name = "replace_existing", defaultValue = "false") boolean replaceExisting,
            @RequestParam(name = "run_inference", defaultValue = "true") boolean runInference,
            HttpServletRequest request) {
        String requestId = String.valueOf(request.getAttribute(RequestIdFilter.ATTRIBUTE));
        return ResponseEntity.accepted().body(
                service.ingest(body.points(), requestId, replaceExisting, runInference));
    }
}
