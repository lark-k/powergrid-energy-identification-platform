package com.sgcc.powergrid.feedback;

import com.sgcc.powergrid.common.RequestIdFilter;
import com.sgcc.powergrid.feedback.FeedbackModels.BatchReceipt;
import com.sgcc.powergrid.feedback.FeedbackModels.BatchRequest;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/ingestion/pv-feedback/batches")
public class FeedbackController {
    private final FeedbackService service;

    public FeedbackController(FeedbackService service) { this.service = service; }

    @PostMapping
    public ResponseEntity<BatchReceipt> ingest(@Valid @RequestBody BatchRequest body, HttpServletRequest request) {
        String requestId = String.valueOf(request.getAttribute(RequestIdFilter.ATTRIBUTE));
        return ResponseEntity.accepted().body(service.ingest(body, requestId));
    }
}
