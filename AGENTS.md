# AGENTS.md

## 项目是什么

BUIDL CTC 2026 Fall 黑客松参赛项目（DoraHacks，主办方 Creditcoin/Credit Labs）。
赛道：**AI**（提交时申报的 Project Sector）。奖金全局 Top3（$10k/$3k/$2k），无按赛道发奖。

产品：「跨链验证驱动的自主 Agent 支付引擎」—— 用户用自然语言下规则（如“当我在 Sepolia 收到 ≥100 USDC 时，在 Creditcoin 铸造付款凭证并释放资产”），Agent 监听源链交易 → Attestcoin Protocol 密码学验证 → ASC 合约自动执行，Writability 反向回传形成闭环。Demo 叙事：跨境自由职业者即时收款。

## 比赛硬性约束（违反即废）

- **截止：2026-09-06 23:59 ET**（注意 ET 时区）。9/18 公布获奖。
- 必须**有意义地集成 Attestcoin Protocol**，“集成深度”是核心评分项 → 同时用 Readability + Writability 才有竞争力。
- 必须部署在测试网：Creditcoin **CC3 Testnet**，源链用 **Ethereum Sepolia**。
- 提交物清单：公开 GitHub 仓库（含 README 复现步骤）、白皮书/Deck PDF、Demo 视频、Attestcoin 集成说明、团队成员真实信息（姓名/邮箱/国籍）、原创声明。
- 所有第三方服务/API（LLM API 等）必须在提交中披露。
- 单人队允许；Eligibility 含无犯罪记录等合规条款。

## 已验证的技术事实（来自 docs.creditcoin.org，勿凭记忆改写）

- SDK：`@gluwa/usc-sdk`（TypeScript，**peer dep ethers v6**）。旧名 USC 未改完，搜资料时两个名字都试。
- 三大组件：`ProofBuilder`（调托管服务 `https://prover.cc3-testnet.creditcoin.network` 生成证明）、`PrecompileChainInfoProvider`（查支持的源链）、`PrecompileBlockProver`（链上验证）。
- 预编译合约 `0x0FD2`：`verify()`（view）/ `verifyAndEmit()`（emit `TransactionVerified`）。
- **关键坑：precompile 只证“交易包含于区块、区块属于已确认源链”，不校验交易成败。ASC 合约必须自行检查 tx status == 0x1，否则有安全漏洞（评审会看）。**
- `chainKey` ≠ EVM chainId：CC3 Testnet 上 Sepolia 是 `chainKey: 1, chainId: 11155111`。
- Attestation 周期性自动发生：先 `waitUntilHeightAttested(chainKey, blockNumber)`（默认轮询 15s / 超时 15min）再生成 proof。**现场演示必须提前触发交易等 attestation，或备好一笔已 attested 的旧交易做 fallback。**
- Batch proof 上限：10 笔 / 跨度 1000 块。
- CC3 Testnet RPC：`https://rpc.cc3-testnet.creditcoin.network`。
- Writability 流向：Creditcoin Outbox 合约 → attestor 共识签名 → relayer 投递到目标链 Inbox 合约。
- 文档技巧：任意页面 URL 加 `.md` 得 markdown；`https://docs.creditcoin.org/llms-full.txt` 全量导出；支持 `GET ...md?ask=<问题>&goal=<目标>` 直接问答。
- Sepolia 测试币需自行从水龙头获取；测试币水龙头见文档 “Using Testnet Faucet” 页。

## 计划架构

```
contracts/   Solidity ASC 合约（Hardhat，部署 CC3 Testnet）
agent/       TypeScript Agent 服务：监听 Sepolia → proof → 验证 → 决策 → 执行循环；Writability 回程
web/         Next.js + Tailwind 仪表盘（规则管理、验证状态流、自然语言查询）
docs/        白皮书 PDF 源、集成说明
```

技术栈：Hardhat + Solidity（ASC）、`@gluwa/usc-sdk` + ethers v6、Node/TS agent、LLM API（规则解析/风控问答）、Next.js 前端。
语言约定：代码、注释、README、提交材料一律英文（评委是国际团队）；与本用户的对话用中文。

## 阶段计划与验收标准

每个 Phase 完成即 git commit（建议打 tag `phase-N`），未达验收标准不开下一阶段。

### Phase 0 — 环境搭建 + 官方教程复现（8/24–8/25）✅ 已完成
- 脚手架按上面四个目录建好（npm workspaces；pnpm 未用）。
- 专用测试网钱包已生成于 `.env`。
- **验收 ✅**：`npm run e2e:proof`（即 `tsx scripts/e2e-proof.ts`）：自动选一笔已 attested 的真实 Sepolia 交易 → 托管服务生成 proof → CC3 Testnet `verifySingle` 返回 SUCCESS。也可用 `TX_HASH=0x... npm run e2e:proof` 指定交易。

## 开发命令（已验证）

```
npm install            # 根目录安装所有 workspace
npm run e2e:proof      # Phase 0 端到端证明验证脚本
npm run typecheck      # tsc --noEmit（根 tsconfig 覆盖 scripts/ 与 agent/src）
npm run test:contracts # hardhat test（10 个用例）
npm run e2e:settle     # Phase 1 dry E2E（无需 gas）
# 部署 + live 结算（需 CC3 测试币后执行）：
npm run deploy:testnet --prefix contracts
npm run e2e:settle:live --prefix contracts
```

## SDK 实测补充（0.18.0 实测，超出文档的部分）

- `verifySingle` 是 **eth_call 只读调用，不需要 gas**；`verifyAndEmitSingle(signer,...)` 才发交易需要 CTC。
- ethers v6 中 `provider.getBlock(h, true)` 返回的 `transactions[i]` **直接是 hash 字符串**，不是对象——别取 `.hash`。
- ChainInfo 的 `chainName` 是 hex 编码字符串（如 `0x5365706f6c6961...` = "Sepolia ethereum"），展示前需 decode。
- Sepolia 公共 RPC 用 `https://ethereum-sepolia-rpc.publicnode.com` 可免注册直连。
- prover 服务有 REST：`GET /api/v1/attested-height/{chainKey}` → `{"attestedHeight":N}`，免链上查询。

## 合约/工程实测坑（Phase 1 踩过的）

- **仓库路径不能含非 ASCII 字符**：Node 24 下中文路径会破坏部分工具的模块解析 → 项目实体在 `~/Documents/dev/attestflow`，旧位置留了 symlink。
- **hardhat 锁 2.26.5**：2.29 的 EDR 节点 fork CC3 直接报 "No known hardfork"；2.26 老 node 能 fork 但会把 `0x0FD2` 预编译当地址段内置劫持 → **fork 模式对预编译不可用**，用 dry 模式替代。
- contracts/ 必须有自己的 tsconfig（module: CommonJS），否则 ts-node 会捡到根 tsconfig 的 ES2022 导致 ESM 报错。
- viaIR 已开启（settle() 栈太深）；**viaIR 下内联汇编读 memory bytes 不可靠**，解码一律用纯 Solidity 循环。
- Sepolia USDC 上 transferFrom(0x23b872dd) 比 transfer 常见得多，ASC 两种 selector 都支持。
- txBytes 布局（encoding v1）：`(uint8 txType, bytes[] chunks)`；chunk[0] 所有类型通用 `(uint64,uint64,address,bool,address,uint256,bytes)`；**最后一块是 receipt 含 status**——ASC 靠这个自查交易成败。

### Phase 1 — ASC 合约最小闭环（8/26–8/28）✅ 代码完成（live 部署等水龙头）
- ASC 合约：验证通过后自动执行业务逻辑（铸造凭证 + 释放资产）。
- **验收**：① 合约部署到 CC3 Testnet，地址与 ABI 固化到 `deployments/`；② 端到端：Sepolia 发起真实 USDC 转账 → proof 验证 → ASC 自动铸凭证，全程日志留痕；③ Hardhat 测试覆盖安全路径：status != 0x1 的交易被拒绝。
- **现状**：③ 已达成（10/10 tests）；② dry 版已达成（真实 USDC 交易真实 proof 字节 → ASC 解码/策略匹配/释放模拟 SUCCESS）；①② 的链上部分被 CC3 水龙头卡住（需 Discord /faucet 给 `.env` 钱包充值）→ `npm run deploy:testnet && npm run e2e:settle:live` 一条命令补完。

### Phase 2 — Agent 服务 + Writability + LLM 规则解析（8/29–8/31）
- 自然语言规则 → 结构化策略配置 JSON；Agent 循环：监听 → 等 attestation → proof → 验证 → 执行。
- Writability：Creditcoin 决策结果经 Outbox 回传 Sepolia Inbox 触发动作（闭环）。
- **验收**：① 一条中文自然语言规则输入后，全流程无人干预跑通并产出可复查日志；② writability 消息在目标链成功触发执行（有链上证据）；③ 服务崩溃重启后能恢复监听不丢事件。

### Phase 3 — 前端仪表盘（9/1–9/3）
- **验收**：① 可创建/启停规则；② 实时展示每笔跨链验证的状态流转（pending → attested → proved → executed）；③ 支持自然语言问答查历史；④ 录屏分辨率下 UI 无布局破损。

### Phase 4 — 提交材料（9/4–9/5）
- **验收**：① 新机器从零 clone → 按 README 跑通 ≤ 30 分钟、无需人工排错；② 白皮书 PDF（问题/方案/架构/协议集成深度/路线图）；③ Demo 视频 2–3 分钟（脚本先行再录）；④ 集成说明单独成章，明确列出 Readability/Writability/precompile 用法与第三方披露。

### Phase 5 — 缓冲与提交（9/5）
- **9/5 提交完毕，绝不卡 9/6 deadline**。提交前对照“比赛硬性约束”逐项勾选。

## 工作纪律

- 本文件中的命令以实际落地为准；脚手架建好后把精确的开发/测试/部署命令补进来，删除过时条目。**不要编造未验证的命令。**
- 私钥、`.env`、助记词永不入 git；demo 用钱包与个人钱包严格分离。
- 每次对接新 API/合约先写最小可运行验证脚本，再进业务代码。
