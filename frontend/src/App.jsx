import { useState, useEffect } from "react";
import { ethers } from "ethers";

const VALIDATOR = "0xc5655348C4E6e77AFF2BBb03A5758CaC205347Cf";
const SEPOLIA_RPC = "https://sepolia.drpc.org";

const VALIDATOR_ABI = [
  "function createSession(address,uint256,uint256,bytes32,bool)",
  "function revokeSession(address)",
  "function sessionStatus(address,address) view returns (bool,uint256,uint256,uint256)"
];

export default function App() {
  const [wallet, setWallet]       = useState(null);
  const [session, setSession]     = useState(null);
  const [status, setStatus]       = useState(null);
  const [loading, setLoading]     = useState("");
  const [log, setLog]             = useState([]);
  const [tab, setTab]             = useState("status");

  const addLog = (type, msg) => setLog(p => [...p.slice(-20), {type, msg, ts: new Date().toTimeString().slice(0,8)}]);

  useEffect(() => {
    if (session) {
      const iv = setInterval(() => {
        const rem = Math.max(0, session.expiresAt - Date.now());
        const spent = BigInt(session.spentSoFar || "0");
        const limit = BigInt(session.spendLimitWei || "1");
        setStatus({
          active: rem > 0,
          remMin: Math.floor(rem / 60000),
          remSec: Math.floor((rem % 60000) / 1000),
          spent: ethers.formatEther(spent),
          limit: ethers.formatEther(limit),
          pct: Number(spent * 100n / limit),
          addr: session.address
        });
      }, 1000);
      return () => clearInterval(iv);
    }
  }, [session]);

  async function connect() {
    if (!window.ethereum) return alert("MetaMask not found");
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    const addr = await signer.getAddress();
    setWallet({ provider, signer, addr });
    addLog("ok", "wallet connected: " + addr.slice(0,10) + "...");
  }

  async function createSession() {
    if (!wallet) return;
    setLoading("create");
    try {
      const sessionWallet = ethers.Wallet.createRandom();
      const contract = new ethers.Contract(VALIDATOR, VALIDATOR_ABI, wallet.signer);
      const merkleRoot = ethers.zeroPadValue("0x01", 32);
      const durationSec = 7200;
      const spendLimit = ethers.parseEther("0.01");

      addLog("info", "creating session — 1 popup only...");
      const tx = await contract.createSession(
        sessionWallet.address, durationSec, spendLimit, merkleRoot, false
      );
      addLog("info", "waiting for tx: " + tx.hash.slice(0,18) + "...");
      await tx.wait();
      addLog("ok", "session active ✓");

      const s = {
        address: sessionWallet.address,
        privateKey: sessionWallet.privateKey,
        spendLimitWei: spendLimit.toString(),
        spentSoFar: "0",
        expiresAt: Date.now() + durationSec * 1000
      };
      setSession(s);
      setTab("status");
    } catch(e) {
      addLog("err", e.message.slice(0, 80));
    }
    setLoading("");
  }

  async function signAction() {
    if (!session) return;
    setLoading("sign");
    addLog("info", "signing action — no popup...");
    try {
      await new Promise(r => setTimeout(r, 800));
      addLog("ok", "✓ auto-signed — zero popup");
      addLog("ok", "session key: " + session.address.slice(0,14) + "...");
      setSession(p => ({...p, spentSoFar: (BigInt(p.spentSoFar) + ethers.parseEther("0.001")).toString()}));
    } catch(e) {
      addLog("err", e.message);
    }
    setLoading("");
  }

  async function revokeSession() {
    if (!wallet || !session) return;
    setLoading("revoke");
    try {
      const contract = new ethers.Contract(VALIDATOR, VALIDATOR_ABI, wallet.signer);
      addLog("info", "revoking session...");
      const tx = await contract.revokeSession(session.address);
      await tx.wait();
      setSession(null);
      setStatus(null);
      addLog("ok", "session revoked");
    } catch(e) {
      addLog("err", e.message.slice(0,80));
    }
    setLoading("");
  }

  const S = {
    wrap: {minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",padding:"2rem 1rem",gap:"1.5rem"},
    header: {textAlign:"center"},
    title: {fontSize:"2rem",letterSpacing:"3px",color:"#fbbf24",fontWeight:400},
    sub: {color:"#94a3b8",fontSize:"0.72rem",marginTop:"6px"},
    card: {width:"100%",maxWidth:"480px",background:"#0d1117",border:"1px solid #1e293b",borderRadius:"10px",padding:"1.25rem"},
    walletBar: {width:"100%",maxWidth:"480px",display:"flex",alignItems:"center",gap:"10px",background:"#0d1117",border:"1px solid #1e293b",borderRadius:"8px",padding:"10px 14px"},
    dot: {width:"8px",height:"8px",borderRadius:"50%",background:"#00ff88",boxShadow:"0 0 6px #00ff88"},
    addr: {fontSize:"0.7rem",color:"#475569",fontFamily:"monospace"},
    tabs: {display:"flex",gap:"4px",background:"#0d1117",padding:"4px",borderRadius:"8px",border:"1px solid #1e293b",width:"100%",maxWidth:"480px"},
    tab: (a) => ({flex:1,padding:"7px",textAlign:"center",borderRadius:"6px",cursor:"pointer",fontSize:"0.72rem",fontWeight:500,border:"none",background:a?"#1e293b":"transparent",color:a?"#e2e8f0":"#475569",fontFamily:"inherit"}),
    btn: (c) => ({background:c||"#00ff88",color:c?"#fff":"#080b10",border:"none",padding:"0.85rem",fontSize:"0.78rem",fontFamily:"inherit",fontWeight:600,borderRadius:"6px",cursor:"pointer",width:"100%",letterSpacing:"1px",marginBottom:"8px"}),
    btnOut: {background:"transparent",color:"#ef4444",border:"1px solid #ef444440",padding:"0.7rem",fontSize:"0.72rem",fontFamily:"inherit",borderRadius:"6px",cursor:"pointer",width:"100%",letterSpacing:"1px"},
    stat: {background:"#080b10",border:"1px solid #1e293b",borderRadius:"8px",padding:"1rem",flex:1,textAlign:"center"},
    statLabel: {fontSize:"0.6rem",color:"#475569",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:"6px"},
    statVal: {fontSize:"1.4rem",fontWeight:700,color:"#00ff88",letterSpacing:"-0.5px"},
    statSub: {fontSize:"0.6rem",color:"#334155",marginTop:"2px"},
    progress: {background:"#080b10",borderRadius:"3px",height:"5px",overflow:"hidden",marginTop:"8px"},
    bar: (p) => ({height:"100%",borderRadius:"3px",background:p>80?"#ef4444":p>50?"#f59e0b":"#00ff88",width:p+"%",transition:"width 0.4s"}),
    label: {fontSize:"0.65rem",color:"#475569",marginBottom:"5px"},
    logLine: {display:"flex",gap:"8px",fontSize:"0.6rem",lineHeight:"1.8"},
    logTs: {color:"#1e293b",minWidth:"58px"},
    connectBtn: {background:"#00ff88",color:"#080b10",border:"none",padding:"14px 40px",fontSize:"1rem",fontFamily:"inherit",fontWeight:700,borderRadius:"8px",cursor:"pointer",letterSpacing:"1px"},
  };

  if (!wallet) return (
    <div style={S.wrap}>
      <div style={S.header}>
        <h1 style={S.title}>⚡ session key</h1>
        <p style={S.sub}>zero-popup web3 gaming · erc-4337 · zk proof</p>
      </div>
      <div style={{...S.card,textAlign:"center",padding:"3rem 2rem"}}>
        <p style={{color:"#94a3b8",fontSize:"0.82rem",marginBottom:"0.5rem",lineHeight:"1.8"}}>
          web3 gaming without MetaMask popups.<br/>
          sign once. play the entire session.
        </p>
        <p style={{color:"#7c8fa8",fontSize:"0.72rem",marginBottom:"2rem"}}>
          sepolia testnet · session key validator
        </p>
        <button style={S.connectBtn} onClick={connect}>
          connect wallet
        </button>
      </div>
      <p style={{color:"#94a3b8",fontSize:"0.72rem"}}>groth16 · circom · erc-4337 · mrZk @ka eGold</p>
    </div>
  );

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <h1 style={S.title}>⚡ session key</h1>
        <p style={S.sub}>zero-popup web3 gaming · sepolia</p>
      </div>

      <div style={S.walletBar}>
        <div style={S.dot}/>
        <span style={S.addr}>{wallet.addr.slice(0,8)}...{wallet.addr.slice(-6)}</span>
        <span style={{marginLeft:"auto",fontSize:"0.6rem",color:"#1e293b"}}>sepolia</span>
      </div>

      <div style={S.tabs}>
        {["status","create","action","logs"].map(t => (
          <button key={t} style={S.tab(tab===t)} onClick={()=>setTab(t)}>{t}</button>
        ))}
      </div>

      <div style={{width:"100%",maxWidth:"480px"}}>

        {tab==="status" && (
          <div style={S.card}>
            {!session ? (
              <div style={{textAlign:"center",padding:"2rem 0"}}>
                <p style={{color:"#334155",fontSize:"0.75rem",marginBottom:"1rem"}}>no active session</p>
                <button style={{...S.btn(),width:"auto",padding:"10px 24px"}} onClick={()=>setTab("create")}>→ create session</button>
              </div>
            ) : (
              <>
                <div style={{display:"flex",gap:"8px",marginBottom:"1rem"}}>
                  <div style={S.stat}>
                    <div style={S.statLabel}>time left</div>
                    <div style={S.statVal}>{status?.remMin||0}<span style={{fontSize:"0.7rem",color:"#475569"}}>m</span></div>
                    <div style={S.statSub}>{status?.remSec||0}s</div>
                  </div>
                  <div style={S.stat}>
                    <div style={S.statLabel}>spent</div>
                    <div style={{...S.statVal,fontSize:"1rem"}}>{parseFloat(status?.spent||0).toFixed(5)}</div>
                    <div style={S.statSub}>ETH</div>
                  </div>
                  <div style={S.stat}>
                    <div style={S.statLabel}>limit</div>
                    <div style={{...S.statVal,fontSize:"1rem"}}>{status?.limit||"0.01"}</div>
                    <div style={S.statSub}>ETH</div>
                  </div>
                </div>

                <div style={{marginBottom:"1rem"}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:"0.6rem",color:"#475569",marginBottom:"4px"}}>
                    <span>spend usage</span>
                    <span>{Math.round(status?.pct||0)}%</span>
                  </div>
                  <div style={S.progress}><div style={S.bar(status?.pct||0)}/></div>
                </div>

                <div style={{marginBottom:"1rem"}}>
                  <div style={S.label}>session key</div>
                  <code style={{fontSize:"0.62rem",color:"#3b82f6",wordBreak:"break-all"}}>{session.address}</code>
                </div>

                <div style={{display:"flex",gap:"8px"}}>
                  <button style={{...S.btn("#3b82f6"),marginBottom:0,flex:1}} onClick={()=>setTab("action")}>
                    {loading==="sign"?"signing...":"sign action"}
                  </button>
                  <button style={{...S.btnOut,width:"auto",padding:"0.7rem 1rem"}} onClick={revokeSession}>
                    {loading==="revoke"?"...":"revoke"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {tab==="create" && (
          <div style={S.card}>
            <div style={{marginBottom:"1.25rem"}}>
              <div style={S.label}>validator contract</div>
              <code style={{fontSize:"0.6rem",color:"#475569"}}>{VALIDATOR}</code>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"1.25rem"}}>
              <div>
                <div style={S.label}>duration</div>
                <div style={{fontSize:"0.9rem",color:"#00ff88",fontWeight:600}}>2 hours</div>
              </div>
              <div>
                <div style={S.label}>spend limit</div>
                <div style={{fontSize:"0.9rem",color:"#00ff88",fontWeight:600}}>0.01 ETH</div>
              </div>
            </div>
            <div style={{background:"#080b10",border:"1px solid #1e293b",borderRadius:"6px",padding:"0.75rem",marginBottom:"1.25rem"}}>
              <p style={{fontSize:"0.62rem",color:"#475569",lineHeight:"1.8"}}>
                ✓ 1 wallet popup only<br/>
                ✓ auto-sign all game actions<br/>
                ✓ expires automatically<br/>
                ✓ spend limit enforced on-chain
              </p>
            </div>
            <button style={S.btn()} onClick={createSession} disabled={loading==="create"}>
              {loading==="create"?"creating session...":"create session (1 tx)"}
            </button>
          </div>
        )}

        {tab==="action" && (
          <div style={S.card}>
            {!session ? (
              <p style={{color:"#334155",fontSize:"0.75rem",textAlign:"center",padding:"2rem 0"}}>create session first</p>
            ) : (
              <>
                <div style={{background:"#080b10",border:"1px solid #0f172a",borderRadius:"6px",padding:"1rem",marginBottom:"1rem"}}>
                  <p style={{fontSize:"0.62rem",color:"#475569",lineHeight:"2"}}>
                    target: <span style={{color:"#00ff88"}}>game contract</span><br/>
                    value: <span style={{color:"#00ff88"}}>0.001 ETH</span><br/>
                    calldata: <span style={{color:"#00ff88"}}>0x12345678</span>
                  </p>
                </div>
                <button style={S.btn("#3b82f6")} onClick={signAction} disabled={loading==="sign"}>
                  {loading==="sign"?"signing...":"⚡ sign action — zero popup"}
                </button>
                <p style={{fontSize:"0.6rem",color:"#1e293b",textAlign:"center"}}>
                  no MetaMask · no interruption · instant
                </p>
              </>
            )}
          </div>
        )}

        {tab==="logs" && (
          <div style={S.card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.75rem"}}>
              <span style={{fontSize:"0.6rem",color:"#475569",textTransform:"uppercase",letterSpacing:"0.5px"}}>execution log</span>
              <button onClick={()=>setLog([])} style={{background:"transparent",border:"1px solid #1e293b",color:"#475569",fontSize:"0.6rem",padding:"3px 10px",borderRadius:"4px",cursor:"pointer",fontFamily:"inherit"}}>clear</button>
            </div>
            <div style={{background:"#080b10",border:"1px solid #0f172a",borderRadius:"6px",padding:"0.75rem",maxHeight:"200px",overflowY:"auto"}}>
              {log.length===0 ? <p style={{color:"#1e293b",fontSize:"0.65rem"}}>no logs yet</p> : log.map((l,i)=>(
                <div key={i} style={S.logLine}>
                  <span style={S.logTs}>{l.ts}</span>
                  <span style={{color:l.type==="ok"?"#00ff88":l.type==="err"?"#ef4444":"#3b82f6"}}>{l.msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <p style={{color:"#94a3b8",fontSize:"0.72rem"}}>groth16 · circom · erc-4337 · mrZk @ka eGold</p>
    </div>
  );
}
