# Crown Court static replay

Run the local static file server.

```sh
cd /workspace/court/site
python3 -m http.server --bind 127.0.0.1
```

Open the printed address, usually [http://127.0.0.1:8000](http://127.0.0.1:8000). The archive includes a bilingual UK demo. Choose a case to replay it, or use a phase link to freeze the scene. For example, open `/?trial=sample_trial&freeze=jury&lang=en`.

The UK protocol runs the two openings concurrently, then the two crosses concurrently. After summing-up it runs three jury batches of four seats concurrently, followed by the verdict.

## 立案与发布 · Filing and publishing

在公开回放页填写案由和可选的案情陈述，使用法庭通行令向书记官立案。真实案卷存于本机和书记官 Worker KV。出示通行令可查阅私人案卷，Worker 副本七天后过期。公开案卷仅提供示范庭审。

File a charge and an optional statement of case with the clerk using the court pass. Real case records are stored locally and in the clerk’s Worker KV. The court passphrase opens the private archive, and Worker copies expire after seven days. The public archive contains the demo trial.

操作员用立案编号运行下列命令。结果在本机生成，并由 routine 在对话里汇报；不会把真实案卷发布到 Pages。`--fixture` 使用本地示范文本，跳过模型调用。

The operator runs the following command with the filed case ID. The trial is written locally and reported in chat by the routine; real records are not published to Pages. Use `--fixture` for an offline run with local demo testimony.

```sh
cd /workspace/court
python3 run_case.py --charge 'CHARGE' --background 'STATEMENT' --lang en --case-id "$case_id"
```

Use `./publish.sh` to republish the public site shell and the demo fixture only. Extra trial JSON arguments are ignored.

本工具是结构化第二意见，并非法律或职业建议。 This is a structured second opinion, not legal advice.
