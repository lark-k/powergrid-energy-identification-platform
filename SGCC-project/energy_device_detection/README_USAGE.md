# 文件、输入格式、推理与训练说明

本文说明项目中各个文件的作用、输入数据格式，以及如何运行两套模型的推理和训练。模型精度、数据来源和使用边界见 [`README.md`](README.md)，光伏分离的详细设计见 [`PV_DISAGGREGATION.md`](PV_DISAGGREGATION.md)。

## 1. 两套模型分别做什么

| 任务 | 推理输入 | 推理输出 | 历史窗口 |
|---|---|---|---:|
| 三类资源实时辨识 | 只使用总开总有功和 A/B/C 三相有功 | 当前分钟光伏、能源站、充电桩的运行概率与 0/1 状态 | 120分钟 |
| 光伏实时分离 | 只使用总开功率和由其计算的因果特征 | 当前分钟从总开中分离出的光伏出力 | 240分钟 |

两个模型独立运行，都只输出已经到达的当前分钟 `t`，不读取 `t+1`，也不预测未来。

- 辨识结果表示当前分钟是否存在可辨识的运行信号，不等同于设备是否物理安装；
- 光伏分离结果表示当前分钟总开中的光伏功率分量，不是未来光伏预测；
- 推理阶段不需要真实光伏表、能源站表或充电桩表，这些分表只在训练和评估阶段提供监督信息。

## 2. 项目文件作用

### 2.1 核心代码

| 文件 | 作用 |
|---|---|
| `data_pipeline.py` | 读取总开、光伏、能源站和充电馈线CSV，先按功率形态校验角色，再按分钟对齐、处理短缺口并构造辨识训练集 |
| `models.py` | 定义三资源辨识使用的因果 TCN 和因果 TCN-LSTM |
| `train.py` | 训练三资源辨识模型，校准三个分类阈值，比较候选模型并选择最终模型 |
| `predict.py` | 使用训练好的辨识模型，对单个CSV或分片目录进行批量/最新分钟推理 |
| `pv_disaggregation_pipeline.py` | 构造同分钟光伏出力分离训练集，生成因果特征并按时间划分训练、验证和测试集 |
| `pv_disaggregation_models.py` | 定义光伏分离使用的因果 TCN 和因果 TCN-LSTM多任务模型 |
| `train_pv_disaggregation.py` | 训练光伏启停分类头和功率回归头，比较候选模型并保存最终光伏分离模型 |
| `predict_pv_disaggregation.py` | 使用训练好的光伏分离模型，对总开数据执行批量/最新分钟分离 |
| `inspect_data.py` | 检查原始数据时间范围、功率形态角色、同源证据、缺失分钟、覆盖率及不同表之间的时间重叠 |
| `pv_disaggregation_diagnostic.py` | 对同步总开/光伏/能源站数据进行光伏分离可行性和基线诊断 |
| `requirements.txt` | Python依赖版本范围 |

### 2.2 训练数据和元数据

| 文件 | 作用 |
|---|---|
| `artifacts/device_detection_dataset.npz` | 已完成归一化和时间划分的三资源辨识训练、验证、测试数据 |
| `artifacts/dataset_metadata.json` | 辨识数据集的窗口数、标签定义、时间划分、归一化参数和插值统计 |
| `artifacts/pv_disaggregation_dataset.npz` | 已完成归一化和时间划分的光伏分离训练、验证、测试数据 |
| `artifacts/pv_disaggregation_dataset_metadata.json` | 光伏分离数据集的标签、特征、时间划分、归一化和插值统计 |
| `artifacts/model_contracts.json` | 两套正式模型的任务语义、输入窗口、输出字段和是否使用未来数据 |
| `artifacts/data_inspection.json` | 原始数据检查结果 |
| `artifacts/data_inventory.csv` | 原始数据文件及数据量清单 |
| `artifacts/aligned_*.csv` | 数据检查阶段生成的同步对齐结果，主要用于诊断，不是在线推理输入 |
| `artifacts/realtime_identification_evaluation.json` | 辨识模型的实时响应延迟、运行耗时和后期数据评估 |
| `artifacts/pv_disaggregation_diagnostic.json` | 光伏分离前的数据和基线诊断结果 |

### 2.3 模型与结果文件

| 文件 | 作用 |
|---|---|
| `outputs/selected_model.pt` | 正式三资源实时辨识模型，推理默认加载此文件 |
| `outputs/model_comparison.json` | 辨识候选模型的训练、验证和测试指标 |
| `outputs/tcn*_checkpoint.pt` | 各辨识候选模型的完整检查点；部署时通常不使用 |
| `outputs/tcn*_best_state.pt` | 各辨识候选模型的最佳权重中间文件 |
| `outputs/realtime_identification_*.csv` | 辨识端到端测试和示例输出 |
| `pv_outputs/selected_pv_model.pt` | 正式光伏实时分离模型，推理默认加载此文件 |
| `pv_outputs/pv_model_comparison.json` | 光伏分离候选模型的训练、验证和测试指标 |
| `pv_outputs/causal_tcn*_checkpoint.pt` | 各光伏候选模型的完整检查点；部署时通常不使用 |
| `pv_outputs/causal_tcn*_best_state.pt` | 各光伏候选模型的最佳权重中间文件 |
| `pv_outputs/selected_model_test_predictions.csv` | 最终光伏模型在独立测试集上的真实值和分离值 |
| `pv_outputs/full_predictions_main_b.csv` | 后期整批数据的逐分钟光伏分离结果 |

## 3. 在线推理输入格式

两套模型的推理输入格式相同，只需要总开分钟数据。程序接受：

1. 单个CSV文件；或
2. 一个包含 `minute_active_power_part_0001.csv`、`minute_active_power_part_0002.csv` 等分片文件的目录。

当输入为目录时，只读取文件名满足 `minute_active_power_part_数字.csv` 的文件；清单文件和其他CSV会被忽略。

原始推理输入字段继续使用下述英文采集字段；模型输出 CSV 则统一使用中文表头。

### 3.1 必需字段

| 字段 | 单位/格式 | 含义 |
|---|---|---|
| `minute_start` | 可被 pandas 解析的时间，例如 `2025-12-03 15:24:00` | 该行对应的分钟起点 |
| `active_power_kw` | kW | 总有功功率 |
| `phase_a_power_w` | W | A相有功功率 |
| `phase_b_power_w` | W | B相有功功率 |
| `phase_c_power_w` | W | C相有功功率 |
| `coverage_ratio` | 0至1 | 该分钟原始采样覆盖率 |

最小可用CSV示例：

```csv
minute_start,active_power_kw,phase_a_power_w,phase_b_power_w,phase_c_power_w,coverage_ratio
2025-12-03 15:23:00,-0.120753706,-110.938525,-538.309578,528.494397,1.0
2025-12-03 15:24:00,0.104819722,-34.591651,-467.096587,606.507961,1.0
```

`active_power_w`、`sample_count`、`is_complete` 等其他字段可以保留，但推理程序不会依赖它们。

### 3.2 时间和质量要求

- 推荐一行对应一分钟，时间升序且不重复；程序会按时间排序，重复分钟保留最后一行；
- `coverage_ratio < 0.1`、功率无效或原本缺行的分钟视为缺失；
- 只有两端存在真实分钟且连续不超过3分钟的缺口才会做双侧线性插值；
- 长缺口、首尾缺口或没有双侧锚点的缺口不填，推理窗口不能跨越这些缺口；
- 辨识至少需要连续120分钟，光伏分离至少需要连续240分钟；
- 输出目标分钟必须是真实总开读数，不能是插值得到的分钟；
- `--latest-only` 要求输入最后一分钟本身有效，且其之前存在完整连续窗口。

质量阈值和最大插值长度默认从模型检查点读取，也可以用 `--min-coverage-ratio` 和 `--max-interpolation-gap-minutes` 覆盖。

## 4. 安装运行环境

建议使用 Python 3.12。CUDA不是必需条件：有可用CUDA时程序自动使用GPU，否则使用CPU。

```powershell
cd C:\Users\YCQ\Desktop\renzhengju\energy_device_detection

python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

主要依赖为 NumPy、pandas 和 PyTorch。

## 5. 如何推理

以下命令都在 `energy_device_detection` 目录中执行。

### 5.1 三资源批量辨识

对目录中所有可形成的120分钟连续窗口逐分钟输出：

```powershell
python predict.py "..\台区数据总开0" `
  --output ".\outputs\resource_predictions.csv"
```

也可以输入单个CSV：

```powershell
python predict.py "..\台区数据总开0\minute_active_power_part_0001.csv" `
  --output ".\outputs\resource_predictions.csv"
```

主要输出字段：

| 字段 | 含义 |
|---|---|
| `目标分钟` | 被辨识的当前分钟 |
| `窗口开始时间`、`窗口结束时间` | 该次辨识使用的历史窗口 |
| `窗口内插值分钟数` | 历史窗口内使用的插值分钟数 |
| `光伏运行概率`、`光伏运行状态` | 当前分钟光伏运行概率和0/1结果 |
| `能源站运行概率`、`能源站运行状态` | 当前分钟能源站馈线运行概率和0/1结果 |
| `充电桩运行概率`、`充电桩运行状态` | 当前分钟充电桩运行概率和0/1结果 |

输出是带 BOM 的 UTF-8 CSV，可直接用 Excel 打开；每个可推理的目标分钟一行，概率是 `[0,1]` 浮点数，状态是整数 `0/1`。当前检查点的完整表头为：

```csv
目标分钟,窗口开始时间,窗口结束时间,窗口内插值分钟数,光伏运行概率,光伏运行状态,能源站运行概率,能源站运行状态,充电桩运行概率,充电桩运行状态
```

### 5.2 三资源最新分钟辨识

```powershell
python predict.py "..\台区数据总开0" `
  --latest-only `
  --output ".\outputs\latest_resource_prediction.csv"
```

该命令只返回输入数据中最新已到达分钟的状态，适合分钟级在线调用。

只输出最近100个有效分钟：

```powershell
python predict.py "..\台区数据总开0" `
  --last-n 100 `
  --output ".\outputs\infer_100_resource_main_b.csv"
```

### 5.3 光伏批量分离

```powershell
python predict_pv_disaggregation.py "..\台区数据总开0" `
  --output ".\pv_outputs\pv_predictions.csv"
```

主要输出字段：

| 字段 | 含义 |
|---|---|
| `目标分钟` | 被分离的当前分钟 |
| `总开有功功率(kW)` | 当前分钟总开有功功率 |
| `窗口内插值分钟数` | 240分钟历史窗口内使用的插值分钟数 |
| `分离光伏发电功率(kW)` | 非负值形式的当前分钟光伏发电功率 |
| `分离光伏有功功率(kW)` | 与原始光伏表符号一致的负功率，等于上一字段的相反数 |
| `光伏运行概率`、`光伏运行状态` | 当前分钟是否存在光伏出力的概率和0/1结果 |

输出同样是带 BOM 的 UTF-8 CSV，每个可分离的目标分钟一行，完整表头为：

```csv
目标分钟,总开有功功率(kW),窗口内插值分钟数,分离光伏发电功率(kW),分离光伏有功功率(kW),光伏运行概率,光伏运行状态
```

### 5.4 光伏最新分钟分离

```powershell
python predict_pv_disaggregation.py "..\台区数据总开0" `
  --latest-only `
  --output ".\pv_outputs\latest_pv_separation.csv"
```

只输出最近100个有效分钟：

```powershell
python predict_pv_disaggregation.py "..\台区数据总开0" `
  --last-n 100 `
  --output ".\pv_outputs\infer_100_pv_main_b.csv"
```

`--last-n` 必须是正整数，且不能与 `--latest-only` 同时使用。

也可以按目标分钟范围推理；起止时间均包含在结果内，时间格式为
`YYYY-MM-DD HH:MM:SS`。例如验证 2025-12-11 晚上 18:30 后的连续
100 个分钟点：

```powershell
python predict.py "..\台区数据总开0" `
  --target-start "2025-12-11 18:30:00" `
  --target-end "2025-12-11 20:09:00" `
  --output ".\outputs\infer_100_evening_resource_20251211.csv"

python predict_pv_disaggregation.py "..\台区数据总开0" `
  --target-start "2025-12-11 18:30:00" `
  --target-end "2025-12-11 20:09:00" `
  --output ".\pv_outputs\infer_100_evening_pv_20251211.csv"
```

`--target-start`、`--target-end` 不能与 `--latest-only` 同时使用。

### 5.5 同一分钟同时运行两套模型

两套模型读取同一份总开数据，但彼此不串联。在线服务可以先常驻加载两个模型，每分钟更新一次240分钟缓冲区，然后分别调用：

```text
最近120分钟总开 ──► 三资源辨识 ──► 三个当前运行状态
最近240分钟总开 ──► 光伏分离 ──► 当前光伏出力（kW）
```

命令行脚本每次都会重新加载模型和CSV，适合验证和离线批处理；正式实时部署时建议将模型常驻内存。

## 6. 训练输入数据

训练脚本目前从项目上一级目录读取固定名称的数据目录。目录名定义在 `data_pipeline.py` 的 `FOLDERS` 中：

```text
renzhengju/
├─ energy_device_detection/
├─ 202511050001 光伏/
├─ 202511050004 总开/
├─ 202511250005 能源站/
├─ 台区数据光伏0/
├─ 台区数据总开0/
├─ 台区数据能源站0/
├─ 台区数据12号/
├─ 台区数据13号/
├─ 充电桩台区2.1-20251231-20260109-12号/
└─ 充电桩台区2.2-20251231-20260109-13号/
```

每个目录内都需要一个或多个 `minute_active_power_part_数字.csv`，字段格式与推理输入一致。

### 6.1 各训练目录含义

| 数据 | 用途 |
|---|---|
| `202511050004 总开` + `202511050001 光伏` + `202511250005 能源站` | 较早同步批次，用于训练光伏/能源站辨识和光伏出力分离 |
| `台区数据总开0` + `台区数据光伏0` + `台区数据能源站0` | 较晚同步批次，按时间划分验证、缓冲和测试段 |
| `台区数据12号`、`台区数据13号` | 较早充电馈线数据，用于充电桩辨识训练 |
| `充电桩台区2.1-20251231-20260109-12号`、`充电桩台区2.2-20251231-20260109-13号` | 较晚充电馈线数据，用于充电桩辨识验证和测试 |

这里没有把未明确命名的目录随意归类：

- 两个光伏目录都是夜间接近 0、白天显著为负的发电曲线；
- 两个能源站目录均为正功率馈线，功率中位数约 2.58/3.15 kW，95% 分位约 26.94/28.20 kW，不是光伏形态；
- `台区数据12号` 是约 0.014 kW 待机与约 7–22 kW 固定平台切换，`台区数据13号` 是约 -0.10 kW 待机与约 7.2 kW 平台切换，均符合充电馈线形态；
- `台区数据12号` 与后来明确命名的 `充电桩台区1_12.22-12.31_12号` 有 476 个重叠分钟，功率平均绝对差约 `2.4e-7 kW`；后者处理日志中的归档名也全部包含在前者中；
- `台区数据13号` 与明确命名的 13 号充电桩目录的处理日志归档名完全同源。明确命名的副本因原始归档为空而没有可用分钟表，所以不重复加入训练。

这些证据记录在 `artifacts/data_inspection.json`，每次构建训练集还会执行独立的功率形态门禁。

时间对齐也不是按行号完成，而是按 `minute_start` 精确内连接：

- 较早同步批次有 11,705 个共同分钟，`总开 - 光伏 - 能源站` 的 RMSE 约 0.305 kW；把任一分表错开 ±1 分钟后 RMSE 会增至约 5.2 kW，说明正确时差是 0；
- 较晚同步批次的最佳时差同样是 0。其残差 RMSE 约 5.08 kW，高于较早批次，但错开 ±1 分钟会进一步增至约 8.47–8.95 kW；
- 较晚批次的大残差包含持续 33 分钟、约 52–89 kW，以及持续 17 分钟、约 52–74 kW 的未单独计量负荷事件，属于等式中的“其他负荷”，不是把光伏或能源站错位造成的；
- 充电馈线从 2025-12-22 才开始，与同步总开/光伏/能源站数据相隔 10 天以上，因此绝不按行号或时间平移混入真实同步样本。

训练标签不是额外CSV字段，而是从同步分表的 `active_power_kw` 自动生成：

- 光伏运行：光伏表 `active_power_kw <= -0.5 kW`；
- 能源站运行：能源站馈线表 `active_power_kw >= 5.0 kW`；
- 充电桩运行：充电馈线 `active_power_kw >= 1.0 kW`；
- 光伏分离目标：`max(-光伏表 active_power_kw, 0)`。

不同表必须使用相同的真实时间戳和计量边界。不要通过行号拼接或人为平移时间来制造同步关系。构建脚本还会根据功率分位数、日夜形态和启停平台自动判别每个目录是光伏、总开、能源站还是充电馈线；判别结果与预期不一致时直接停止训练，避免只看目录名误归类。

## 7. 如何重新训练

### 7.1 可选：先检查原始数据

```powershell
python inspect_data.py
```

检查结果写入 `artifacts/data_inspection.json` 和 `artifacts/data_inventory.csv`。

### 7.2 构建三资源辨识数据集

```powershell
python data_pipeline.py
```

默认生成：

- `artifacts/device_detection_dataset.npz`
- `artifacts/dataset_metadata.json`

需要修改数据质量参数时：

```powershell
python data_pipeline.py `
  --window-size 120 `
  --stride 1 `
  --synthetic-train 6000 `
  --synthetic-eval 1200 `
  --min-coverage-ratio 0.1 `
  --max-interpolation-gap-minutes 3
```

### 7.3 训练三资源辨识模型

用于复现当前训练设置的命令：

```powershell
python train.py `
  --epochs 20 `
  --patience 5 `
  --batch-size 1024 `
  --learning-rate 0.002
```

程序同时比较 `tcn` 和 `tcn_lstm`，使用验证集 Macro F1 选择模型，生成：

- `outputs/selected_model.pt`
- `outputs/model_comparison.json`

只训练指定结构时可使用：

```powershell
python train.py --models tcn_lstm
```

### 7.4 构建光伏分离数据集

```powershell
python pv_disaggregation_pipeline.py
```

默认生成：

- `artifacts/pv_disaggregation_dataset.npz`
- `artifacts/pv_disaggregation_dataset_metadata.json`

完整参数示例：

```powershell
python pv_disaggregation_pipeline.py `
  --window-size 240 `
  --train-stride 1 `
  --evaluation-stride 1 `
  --active-threshold-kw 0.5 `
  --min-coverage-ratio 0.1 `
  --max-interpolation-gap-minutes 3
```

### 7.5 训练光伏分离模型

```powershell
python train_pv_disaggregation.py `
  --epochs 30 `
  --patience 6 `
  --batch-size 512 `
  --learning-rate 0.002
```

程序同时比较 `causal_tcn` 和 `causal_tcn_lstm`，使用验证集功率误差选择模型，生成：

- `pv_outputs/selected_pv_model.pt`
- `pv_outputs/pv_model_comparison.json`
- `pv_outputs/selected_model_test_predictions.csv`

只训练指定结构时可使用：

```powershell
python train_pv_disaggregation.py --models causal_tcn_lstm
```

### 7.6 从独立测试集抽取1000点复测

以下命令分别从两套模型的 `test` 划分等间隔抽取1000个点，重新加载
最终检查点执行推理并计算指标：

```powershell
python evaluate_holdout_1000.py --sample-size 1000
```

辨识复测只选择真实总开和真实充电馈线测试点，排除合成样本。默认用
500个总开测试点评价光伏、能源站，用500个充电馈线测试点评价充电桩；
没有同步真值的标签留空，不参与准确率。光伏分离1000点覆盖独立测试段
的完整时间范围，输出 MAE、RMSE、平均偏差、R²、累计电量偏差及运行
状态指标。

结果保存在 `outputs/holdout_1000_20260731/`。可用 `--output-dir` 修改
输出目录。

## 8. 接入新数据时需要修改什么

如果新数据目录名与当前目录不同，需要修改 `data_pipeline.py` 顶部的 `FOLDERS` 映射，或者把新目录整理成当前名称。修改后按以下顺序重新运行：

```text
检查CSV字段和时间戳
        ↓
更新 FOLDERS
        ↓
运行 data_pipeline.py / pv_disaggregation_pipeline.py
        ↓
检查两个 metadata.json 的时间划分和插值统计
        ↓
运行 train.py / train_pv_disaggregation.py
        ↓
仅根据验证集选型，最后查看独立测试集指标
```

新增数据时应特别检查：

- 总开、光伏、能源站和充电桩是否属于同一个计量边界；
- 分表时间是否与总开真实同步；
- 功率单位和正负号是否与当前约定一致；
- 训练、验证、测试是否按时间隔离；
- 是否存在超过3分钟的缺口；
- 新台区、季节和容量是否需要单独外部测试。

当前充电桩数据与同步总开/光伏/能源站数据没有时间重叠，因此不能把现有充电桩指标视为已经在真实四类混合总开中完成验证。
