# NEON VRM Motion Studio

完全ローカルで動作する、音声駆動VRMバーチャルヒューマン基盤です。
VRMファイルと入力音声はブラウザー内だけで処理され、外部APIやサーバーへアップロードされません。

<img width="1257" height="872" alt="Image" src="https://github.com/user-attachments/assets/5a9f912e-b3e7-4300-8634-be897df77ecd" />

## 現在できること

- VRM 0.x / VRM 1.0ファイルのドラッグ＆ドロップ読み込み
- VRM・全VRMAをIndexedDBへ保存し、次回起動時に自動復元
- 口感度・動作量・入力デバイス選択をローカル保存
- VRMAの `IDLE / TALK A / TALK B / EMPHASIS / LISTEN / NOD / GREETING` 個別読み込み
- 通常会話モーションの交互選択と、強い発話時の強調モーション選択
- 短い音節間の無音ではモーションを切り替えない240msホールド
- 発話状態に応じた待機／会話モーションのクロスフェード
- ファイル選択ダイアログからのVRM読み込み・モデル交換
- マウス操作による回転・ズーム・表示位置調整
- VBCABLEを含む音声入力デバイスの選択
- Web Audio APIによる完全ローカル音声解析
- VRM標準表情 `aa / ih / ou / ee / oh` を使った母音リップシンク
- VRM標準 `blink` 表情による非周期的な自動瞬き
- 頭・首・胸・背骨・腰・脚を使った全身待機モーション
- 発話開始を検出して左右交互に行う腕・肘・手首ジェスチャー
- 呼吸、重心移動、膝の緩み、足首の微動
- 常時カメラ目線。目が先、頭が小さく遅れてカメラへ追従
- VRMA再生後の腰ルートドリフト抑制と床面への足位置補正
- 口の感度と動作量のリアルタイム調整

## セットアップ

Node.js 20以上が必要です。

```powershell
git clone https://github.com/<your-account>/neon-vrm-motion-studio.git
cd neon-vrm-motion-studio
npm install
copy config.example.json config.json
```

`config.json` はローカル設定ファイルでリポジトリには含まれません。`config.example.json` をコピーして、ポートやSTT/LLM/TTSの接続先を環境に合わせて編集してください。

### 同梱していないアセット

ライセンス・容量・肖像権の都合により、次のファイルはリポジトリに含めていません。ローカルで各自用意してください。

| パス | 内容 | 入手方法 |
| --- | --- | --- |
| `motions/vrm/*.vrm` | VRMモデル | 各自の配布元から取得。UIからドラッグ＆ドロップでも読み込めます |
| `motions/simple-generated/*.vrma` | 基本モーション | `npm run generate:motions` で生成します |
| `VRMA_MotionPack/` | pixiv VRMA Motion Pack | 配布元から取得（再配布禁止） |
| `models/whisper/ggml-base.bin` | Whisperモデル | [whisper.cpp](https://github.com/ggerganov/whisper.cpp) のモデル配布先から取得 |
| `tools/whisper/Release/` | whisper.cppビルド成果物 | whisper.cppを自前ビルドするか公式リリースを配置 |
| `public/assets/` | 写真アバター素材 | 各自用意（実写素材のため非公開） |
| `tools/fbx2vrma-converter/` | FBX→VRMA変換ツール | `git clone https://github.com/tk256ailab/fbx2vrma-converter.git tools/fbx2vrma-converter` |

### 外部プロセス（任意）

音声対話（STT/LLM/TTS）を使う場合は、`config.json` の接続先に合わせて次を起動します。VRM表示とリップシンクだけならいずれも不要です。

- LLM: OpenAI互換サーバー（LM Studio等）を `http://127.0.0.1:1234`
- STT: `powershell -ExecutionPolicy Bypass -File .\start-whisper.ps1`（ffmpegが必要。PATHに無い場合は環境変数 `NEON_FFMPEG_DIR` で指定）
- TTS: OpenAI互換TTSサーバーを `http://127.0.0.1:9880`

## 起動

Node.js 20以上が必要です。初回のみ依存関係をインストールします。

通常は次のバッチをダブルクリックしてください。サーバー起動後、URLも自動的に開きます。

```text
start-neon-vrm.bat
```

コマンドから起動する場合：

```powershell
npm install
powershell -ExecutionPolicy Bypass -File .\start-local-human.ps1
```

ブラウザーで `http://127.0.0.1:4782` を開きます。
画面中央へ `.vrm` ファイルをドロップするか、「VRMファイルを選択」を押してください。
右パネルの `IDLE`、`TALK A`、`TALK B`、`EMPHASIS` から、それぞれの `.vrma` モーションを読み込みます。
`TALK B`と`EMPHASIS`は任意です。未設定時は`TALK A`へ自動フォールバックします。
`LISTEN`はループ再生、`NOD`と`GREETING`は一回だけ再生してからIDLEまたは会話モーションへ戻ります。
VRMと複数のVRMAをまとめてドロップすることもできます。
読み込んだVRM・VRMAはブラウザーのローカルストレージ領域へ保存され、ページ更新後も自動復元されます。音声リンクはブラウザーのセキュリティ制約により毎回手動で開始します。

## OBS Browser Source

OBSから直接配信表示を開く場合:

```text
http://127.0.0.1:4782/?broadcast=1
```

透明背景・自動画質:

```text
http://127.0.0.1:4782/?broadcast=1&background=transparent&quality=auto
```

クロマキー緑・標準画質:

```text
http://127.0.0.1:4782/?broadcast=1&background=green&quality=standard
```

対応パラメーター:

- `broadcast=1`: 設定UIを隠して配信表示
- `ui=0`: `broadcast=1`と同じ
- `background=blue|transparent|green`
- `quality=auto|low|standard|high`

URLパラメーターはその起動中だけ有効で、通常画面に保存した背景・品質設定は上書きしません。ブラウザーの制約により音声リンクはURLから自動開始できません。

## 開発

```powershell
npm run build
npm run check
npm run generate:motions
```

ソースは `src/vrm-app.js`、生成済みブラウザーバンドルは `public/app.js` です。

## 簡易VRMAジェネレーター

`tools/generate-simple-vrma.mjs`は、FBXを使わずVRM標準Humanoidボーンのキーフレームから以下を生成します。

- `Idle.vrma`
- `Talk-A.vrma`
- `Talk-B.vrma`
- `Emphasis.vrma`
- `Listen.vrma`
- `Nod.vrma`
- `Greeting.vrma`

出力先は `motions/simple-generated` です。ループモーションは先頭と末尾を同じ姿勢にし、30fps再サンプリング、イーズイン・アウト、肩から手首・指先へ伝わる関節遅延を適用して保存します。左右30本の指ボーンを含み、待機時の軽い開閉、会話時の握り、強調時の開いた手を生成します。

## 写真版

移行前の実写写真版は `legacy-photo-avatar` に保存されています。VRM版とは独立して残してあります。

## ライセンス

本リポジトリのソースコードは [MIT License](LICENSE) です。

同梱していないアセット（VRMモデル、VRMA Motion Pack、Whisperモデル、whisper.cppバイナリ、写真素材）は、それぞれの配布元のライセンス・利用規約に従います。特にpixiv VRMA Motion Packは再配布が禁止されているため、本リポジトリには含めていません。

## プライバシー

VRMファイル・入力音声はブラウザーおよびローカルプロセス内でのみ処理され、外部APIやサーバーへ送信されません。STT/LLM/TTSの接続先はすべて `127.0.0.1` のローカルサーバーを既定としています。
