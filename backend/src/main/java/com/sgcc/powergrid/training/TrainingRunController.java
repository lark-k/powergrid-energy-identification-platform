package com.sgcc.powergrid.training;

import com.sgcc.powergrid.common.ApiException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/training-runs")
@PreAuthorize("hasRole('ADMIN')")
public class TrainingRunController {
    private final JdbcClient jdbc;
    public TrainingRunController(JdbcClient jdbc) { this.jdbc = jdbc; }

    @PostMapping
    @Transactional
    public Map<String, Object> create(@Valid @RequestBody CreateRun request) {
        int inserted = jdbc.sql("""
                insert into training_run (run_id, station_id, status, model_version,
                  dataset_window_days, sample_count, started_at, completed_at,
                  validation_score, source_record, created_at)
                values (:runId, :stationId, 'running', :version, :days, :samples,
                  :startedAt, null, null, :parameters, :now)
                """).param("runId", request.runId()).param("stationId", request.stationId())
                .param("version", request.modelVersion()).param("days", request.datasetWindowDays())
                .param("samples", request.sampleCount()).param("startedAt", request.startedAt())
                .param("parameters", request.parametersJson()).param("now", OffsetDateTime.now()).update();
        return Map.of("run_id", request.runId(), "status", inserted == 1 ? "running" : "failed");
    }

    @PostMapping("/{runId}/epochs")
    public Map<String, Object> epoch(@PathVariable String runId, @Valid @RequestBody Epoch request) {
        int inserted = jdbc.sql("""
                insert into training_epoch (run_id, epoch, training_loss, validation_score, recorded_at)
                select :runId, :epoch, :loss, :score, :recordedAt
                where exists (select 1 from training_run where run_id = :runId and status = 'running')
                on conflict (run_id, epoch) do nothing
                """).param("runId", runId).param("epoch", request.epoch())
                .param("loss", request.trainingLoss()).param("score", request.validationScore())
                .param("recordedAt", request.recordedAt()).update();
        if (inserted != 1) throw new ApiException(HttpStatus.CONFLICT, "TRAINING_EPOCH_REJECTED",
                "训练运行不存在、已结束或 epoch 重复");
        return Map.of("run_id", runId, "epoch", request.epoch(), "status", "recorded");
    }

    @PostMapping("/{runId}/complete")
    public Map<String, Object> complete(@PathVariable String runId, @Valid @RequestBody Complete request) {
        int changed = jdbc.sql("""
                update training_run set status = :status, validation_score = :score,
                  completed_at = :completedAt where run_id = :runId and status = 'running'
                """).param("status", request.status()).param("score", request.validationScore())
                .param("completedAt", request.completedAt()).param("runId", runId).update();
        if (changed != 1) throw new ApiException(HttpStatus.CONFLICT, "TRAINING_RUN_NOT_RUNNING",
                "训练运行不存在或已经结束");
        return Map.of("run_id", runId, "status", request.status());
    }

    public record CreateRun(@NotBlank String runId, String stationId, @NotBlank String modelVersion,
            @Min(1) int datasetWindowDays, @Min(1) int sampleCount,
            @NotNull OffsetDateTime startedAt, @NotBlank String parametersJson) {}
    public record Epoch(@Min(1) int epoch, double trainingLoss,
            @DecimalMin("0") @DecimalMax("1") double validationScore,
            @NotNull OffsetDateTime recordedAt) {
        public Epoch {
            if (!Double.isFinite(trainingLoss) || trainingLoss < 0) throw new IllegalArgumentException("training_loss 必须为非负有限数");
        }
    }
    public record Complete(@NotBlank String status,
            @DecimalMin("0") @DecimalMax("1") Double validationScore,
            @NotNull OffsetDateTime completedAt) {
        public Complete {
            if (status != null && !status.matches("completed|failed")) throw new IllegalArgumentException("status 必须为 completed 或 failed");
        }
    }
}
