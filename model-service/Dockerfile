FROM python:3.13.6-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN groupadd --system --gid 10001 model && useradd --system --uid 10001 --gid model --home /app model
WORKDIR /app
COPY model-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY model-service/app ./app
COPY model-service/artifacts ./artifacts
RUN mkdir -p /opt/sgcc/energy_device_detection/outputs /opt/sgcc/energy_device_detection/pv_outputs
COPY SGCC-project/energy_device_detection/data_pipeline.py /opt/sgcc/energy_device_detection/
COPY SGCC-project/energy_device_detection/models.py /opt/sgcc/energy_device_detection/
COPY SGCC-project/energy_device_detection/predict.py /opt/sgcc/energy_device_detection/
COPY SGCC-project/energy_device_detection/predict_pv_disaggregation.py /opt/sgcc/energy_device_detection/
COPY SGCC-project/energy_device_detection/pv_disaggregation_models.py /opt/sgcc/energy_device_detection/
COPY SGCC-project/energy_device_detection/outputs/selected_model.pt /opt/sgcc/energy_device_detection/outputs/
COPY SGCC-project/energy_device_detection/pv_outputs/selected_pv_model.pt /opt/sgcc/energy_device_detection/pv_outputs/
COPY SGCC-project/energy_device_detection/outputs/*_checkpoint.pt /opt/sgcc/energy_device_detection/outputs/
COPY SGCC-project/energy_device_detection/pv_outputs/*_checkpoint.pt /opt/sgcc/energy_device_detection/pv_outputs/
RUN mkdir -p /var/lib/powergrid-models && chown -R model:model /app /opt/sgcc /var/lib/powergrid-models
USER 10001
EXPOSE 8000
CMD ["python","-m","uvicorn","app.main:app","--host","0.0.0.0","--port","8000","--no-access-log"]
