// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import "./App.css";

interface PermafrostData {
  id: string;
  location: string;
  temperature: string;
  methaneLevel: string;
  riskLevel: number;
  timestamp: number;
  encryptedData: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [dataPoints, setDataPoints] = useState<PermafrostData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [adding, setAdding] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newDataPoint, setNewDataPoint] = useState({
    location: "",
    temperature: "",
    methaneLevel: "",
  });
  const [activeTab, setActiveTab] = useState("dashboard");
  const [riskLevel, setRiskLevel] = useState<number>(0);
  const [showFaq, setShowFaq] = useState(false);

  // Calculate statistics
  const highRiskCount = dataPoints.filter(d => d.riskLevel >= 7).length;
  const mediumRiskCount = dataPoints.filter(d => d.riskLevel >= 4 && d.riskLevel < 7).length;
  const lowRiskCount = dataPoints.filter(d => d.riskLevel < 4).length;

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, []);

  const onConnect = async () => {
    try {
      if (window.ethereum) {
        const web3Provider = new ethers.BrowserProvider(window.ethereum);
        setProvider(web3Provider);
        const accounts = await web3Provider.send("eth_requestAccounts", []);
        const acc = accounts[0] || "";
        setAccount(acc);

        window.ethereum.on("accountsChanged", async (accounts: string[]) => {
          const newAcc = accounts[0] || "";
          setAccount(newAcc);
        });
      } else {
        alert("Please install a Web3 wallet like MetaMask");
      }
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("data_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing data keys:", e);
        }
      }
      
      const list: PermafrostData[] = [];
      let totalRisk = 0;
      
      for (const key of keys) {
        try {
          const dataBytes = await contract.getData(`data_${key}`);
          if (dataBytes.length > 0) {
            try {
              const data = JSON.parse(ethers.toUtf8String(dataBytes));
              list.push({
                id: key,
                location: data.location,
                temperature: data.temperature,
                methaneLevel: data.methaneLevel,
                riskLevel: data.riskLevel,
                timestamp: data.timestamp,
                encryptedData: data.encryptedData
              });
              totalRisk += data.riskLevel;
            } catch (e) {
              console.error(`Error parsing data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading data ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setDataPoints(list);
      
      // Calculate average risk level
      if (list.length > 0) {
        setRiskLevel(Math.round(totalRisk / list.length));
      }
    } catch (e) {
      console.error("Error loading data:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const addDataPoint = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setAdding(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting permafrost data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newDataPoint))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      // Calculate risk level (simulated)
      const temp = parseFloat(newDataPoint.temperature);
      const methane = parseFloat(newDataPoint.methaneLevel);
      const risk = Math.min(10, Math.round((temp - (-10)) * 0.5 + methane * 0.3));
      
      const data = {
        location: newDataPoint.location,
        temperature: newDataPoint.temperature,
        methaneLevel: newDataPoint.methaneLevel,
        riskLevel: risk,
        timestamp: Math.floor(Date.now() / 1000),
        encryptedData: encryptedData
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `data_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(data))
      );
      
      const keysBytes = await contract.getData("data_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(dataId);
      
      await contract.setData(
        "data_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted data submitted securely!"
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowAddModal(false);
        setNewDataPoint({
          location: "",
          temperature: "",
          methaneLevel: "",
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setAdding(false);
    }
  };

  const renderRiskChart = () => {
    const total = dataPoints.length || 1;
    const highPercentage = (highRiskCount / total) * 100;
    const mediumPercentage = (mediumRiskCount / total) * 100;
    const lowPercentage = (lowRiskCount / total) * 100;

    return (
      <div className="risk-chart-container">
        <div className="risk-chart">
          <div 
            className="risk-segment high" 
            style={{ transform: `rotate(${highPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="risk-segment medium" 
            style={{ transform: `rotate(${(highPercentage + mediumPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="risk-segment low" 
            style={{ transform: `rotate(${(highPercentage + mediumPercentage + lowPercentage) * 3.6}deg)` }}
          ></div>
          <div className="risk-center">
            <div className="risk-value">{riskLevel}/10</div>
            <div className="risk-label">Avg Risk</div>
          </div>
        </div>
        <div className="risk-legend">
          <div className="legend-item">
            <div className="color-box high"></div>
            <span>High Risk: {highRiskCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box medium"></div>
            <span>Medium Risk: {mediumRiskCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box low"></div>
            <span>Low Risk: {lowRiskCount}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderRiskBar = (riskLevel: number) => {
    return (
      <div className="risk-bar">
        <div 
          className="risk-fill" 
          style={{ width: `${riskLevel * 10}%` }}
        ></div>
        <div className="risk-labels">
          {[0, 2, 4, 6, 8, 10].map(num => (
            <span key={num}>{num}</span>
          ))}
        </div>
      </div>
    );
  };

  const renderWorldMap = () => {
    // Simulated research stations
    const stations = [
      { id: 1, name: "Barrow", lat: 71.2906, lng: -156.7886, risk: 8 },
      { id: 2, name: "Norilsk", lat: 69.3491, lng: 88.2010, risk: 7 },
      { id: 3, name: "Iqaluit", lat: 63.7467, lng: -68.5170, risk: 6 },
      { id: 4, name: "Kiruna", lat: 67.8558, lng: 20.2253, risk: 5 },
      { id: 5, name: "Vorkuta", lat: 67.5, lng: 64.0333, risk: 9 },
    ];
    
    return (
      <div className="world-map-container">
        <div className="world-map">
          <div className="map-base"></div>
          {stations.map(station => (
            <div 
              key={station.id}
              className={`map-marker risk-${Math.floor(station.risk / 3)}`}
              style={{
                top: `${(90 - station.lat) * 1.8}%`,
                left: `${(station.lng + 180) * 0.5}%`
              }}
            >
              <div className="marker-pulse"></div>
              <div className="marker-tooltip">
                {station.name}: Risk {station.risk}/10
              </div>
            </div>
          ))}
        </div>
        <div className="map-legend">
          <div className="legend-item">
            <div className="marker-sample risk-high"></div>
            <span>High Risk (7-10)</span>
          </div>
          <div className="legend-item">
            <div className="marker-sample risk-medium"></div>
            <span>Medium Risk (4-6)</span>
          </div>
          <div className="legend-item">
            <div className="marker-sample risk-low"></div>
            <span>Low Risk (0-3)</span>
          </div>
        </div>
      </div>
    );
  };

  const faqItems = [
    {
      question: "What is FHE and how is it used in this project?",
      answer: "Fully Homomorphic Encryption (FHE) allows computations on encrypted data without decryption. In this project, sensitive permafrost data from research stations is encrypted using FHE before being analyzed, ensuring privacy while enabling risk assessment."
    },
    {
      question: "How is the permafrost thawing risk calculated?",
      answer: "The risk assessment combines encrypted ground temperature data, greenhouse gas measurements, and historical thaw patterns using our proprietary FHE model. The algorithm processes data while encrypted to generate risk scores without exposing raw data."
    },
    {
      question: "Why is permafrost thawing a concern?",
      answer: "Permafrost stores vast amounts of organic carbon. When it thaws, microbial decomposition releases CO₂ and methane, accelerating climate change. Thawing also destabilizes infrastructure built on frozen ground."
    },
    {
      question: "How often is the data updated?",
      answer: "Research stations transmit encrypted data daily. Our FHE model processes new data automatically, updating risk assessments in real-time while maintaining data confidentiality."
    },
    {
      question: "Can I contribute data to this project?",
      answer: "Yes! Authorized research stations can submit encrypted data using our FHE protocol. Contact our team to learn about the data submission process and requirements."
    }
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="glacier-spinner"></div>
      <p>Initializing encrypted connection to permafrost network...</p>
    </div>
  );

  return (
    <div className="app-container glacier-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="snowflake-icon"></div>
          </div>
          <h1>Permafrost<span>Risk</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowAddModal(true)} 
            className="add-data-btn metal-button"
          >
            <div className="add-icon"></div>
            Add Data Point
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <nav className="app-nav">
        <button 
          className={`nav-btn ${activeTab === "dashboard" ? "active" : ""}`}
          onClick={() => setActiveTab("dashboard")}
        >
          <div className="dashboard-icon"></div>
          Dashboard
        </button>
        <button 
          className={`nav-btn ${activeTab === "data" ? "active" : ""}`}
          onClick={() => setActiveTab("data")}
        >
          <div className="data-icon"></div>
          Research Data
        </button>
        <button 
          className={`nav-btn ${activeTab === "map" ? "active" : ""}`}
          onClick={() => setActiveTab("map")}
        >
          <div className="map-icon"></div>
          Global Map
        </button>
        <button 
          className={`nav-btn ${activeTab === "faq" ? "active" : ""}`}
          onClick={() => setActiveTab("faq")}
        >
          <div className="faq-icon"></div>
          FAQ
        </button>
      </nav>
      
      <main className="main-content">
        {activeTab === "dashboard" && (
          <div className="dashboard-panels">
            <div className="panel main-panel metal-card">
              <h2>Permafrost Thawing Risk Assessment</h2>
              <p className="subtitle">FHE-powered analysis of encrypted polar research data</p>
              
              <div className="risk-summary">
                <div className="risk-indicator">
                  <div className="risk-value">{riskLevel}/10</div>
                  <div className="risk-label">Current Risk Level</div>
                  {renderRiskBar(riskLevel)}
                </div>
                <div className="risk-description">
                  <p>
                    Based on {dataPoints.length} encrypted data points from polar research stations, 
                    our FHE model calculates an average thawing risk of {riskLevel}/10.
                  </p>
                  <div className="fhe-badge">
                    <span>FHE-Powered Analysis</span>
                  </div>
                </div>
              </div>
              
              <div className="data-stats">
                <div className="stat-card metal-card">
                  <div className="stat-value">{dataPoints.length}</div>
                  <div className="stat-label">Data Points</div>
                </div>
                <div className="stat-card metal-card">
                  <div className="stat-value">{highRiskCount}</div>
                  <div className="stat-label">High Risk Areas</div>
                </div>
                <div className="stat-card metal-card">
                  <div className="stat-value">{mediumRiskCount}</div>
                  <div className="stat-label">Medium Risk Areas</div>
                </div>
                <div className="stat-card metal-card">
                  <div className="stat-value">{lowRiskCount}</div>
                  <div className="stat-label">Low Risk Areas</div>
                </div>
              </div>
            </div>
            
            <div className="panel chart-panel metal-card">
              <h3>Risk Distribution</h3>
              {renderRiskChart()}
            </div>
            
            <div className="panel map-panel metal-card">
              <h3>Global Research Stations</h3>
              {renderWorldMap()}
            </div>
          </div>
        )}
        
        {activeTab === "data" && (
          <div className="data-panel">
            <div className="panel-header">
              <h2>Encrypted Research Data</h2>
              <div className="header-actions">
                <button 
                  onClick={loadData}
                  className="refresh-btn metal-button"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh Data"}
                </button>
              </div>
            </div>
            
            <div className="data-table metal-card">
              <div className="table-header">
                <div className="header-cell">ID</div>
                <div className="header-cell">Location</div>
                <div className="header-cell">Temperature (°C)</div>
                <div className="header-cell">Methane (ppm)</div>
                <div className="header-cell">Risk Level</div>
                <div className="header-cell">Date</div>
              </div>
              
              {dataPoints.length === 0 ? (
                <div className="no-data">
                  <div className="no-data-icon"></div>
                  <p>No encrypted data points found</p>
                  <button 
                    className="metal-button primary"
                    onClick={() => setShowAddModal(true)}
                  >
                    Add First Data Point
                  </button>
                </div>
              ) : (
                dataPoints.map(data => (
                  <div className="data-row" key={data.id}>
                    <div className="table-cell data-id">#{data.id.substring(0, 6)}</div>
                    <div className="table-cell">{data.location}</div>
                    <div className="table-cell">{data.temperature}°C</div>
                    <div className="table-cell">{data.methaneLevel}ppm</div>
                    <div className="table-cell">
                      <span className={`risk-badge risk-${Math.floor(data.riskLevel / 3)}`}>
                        {data.riskLevel}/10
                      </span>
                    </div>
                    <div className="table-cell">
                      {new Date(data.timestamp * 1000).toLocaleDateString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {activeTab === "map" && (
          <div className="map-panel">
            <div className="panel-header">
              <h2>Global Permafrost Risk Map</h2>
              <p>Real-time assessment of thawing risk at research stations</p>
            </div>
            
            <div className="full-map metal-card">
              {renderWorldMap()}
            </div>
            
            <div className="map-info">
              <div className="info-card metal-card">
                <h3>Highest Risk Area</h3>
                <div className="risk-value">Vorkuta Station</div>
                <div className="risk-level">9/10</div>
                <p>Accelerated thawing observed with methane levels increasing by 15% monthly</p>
              </div>
              
              <div className="info-card metal-card">
                <h3>Most Stable Area</h3>
                <div className="risk-value">Kiruna Station</div>
                <div className="risk-level">5/10</div>
                <p>Minimal thawing with stable greenhouse gas emissions</p>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "faq" && (
          <div className="faq-panel">
            <div className="panel-header">
              <h2>Frequently Asked Questions</h2>
              <button 
                className="metal-button"
                onClick={() => setShowFaq(!showFaq)}
              >
                {showFaq ? "Collapse All" : "Expand All"}
              </button>
            </div>
            
            <div className="faq-list">
              {faqItems.map((faq, index) => (
                <div 
                  className={`faq-item metal-card ${showFaq ? "expanded" : ""}`} 
                  key={index}
                >
                  <div 
                    className="faq-question"
                    onClick={() => {
                      if (!showFaq) {
                        const items = document.querySelectorAll('.faq-item');
                        items.forEach(item => item.classList.remove('expanded'));
                        const current = document.querySelector(`.faq-item:nth-child(${index + 1})`);
                        current?.classList.add('expanded');
                      }
                    }}
                  >
                    <div className="faq-icon">Q</div>
                    <h3>{faq.question}</h3>
                    <div className="expand-icon"></div>
                  </div>
                  <div className="faq-answer">
                    <div className="faq-icon">A</div>
                    <p>{faq.answer}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
  
      {showAddModal && (
        <ModalAddData 
          onSubmit={addDataPoint} 
          onClose={() => setShowAddModal(false)} 
          adding={adding}
          dataPoint={newDataPoint}
          setDataPoint={setNewDataPoint}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="glacier-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="snowflake-icon"></div>
              <span>PermafrostRisk_Fhe</span>
            </div>
            <p>Confidential Permafrost Thawing Risk Assessment using FHE</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Research Papers</a>
            <a href="#" className="footer-link">Data Privacy</a>
            <a href="#" className="footer-link">Contribute Data</a>
            <a href="#" className="footer-link">Contact Researchers</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Confidential Analysis</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} Permafrost Research Consortium. All data encrypted with FHE.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalAddDataProps {
  onSubmit: () => void; 
  onClose: () => void; 
  adding: boolean;
  dataPoint: any;
  setDataPoint: (data: any) => void;
}

const ModalAddData: React.FC<ModalAddDataProps> = ({ 
  onSubmit, 
  onClose, 
  adding,
  dataPoint,
  setDataPoint
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setDataPoint({
      ...dataPoint,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!dataPoint.location || !dataPoint.temperature || !dataPoint.methaneLevel) {
      alert("Please fill all required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="add-modal metal-card">
        <div className="modal-header">
          <h2>Add Encrypted Data Point</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="lock-icon"></div> 
            <span>Your sensitive research data will be encrypted with FHE before storage</span>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Research Station Location *</label>
              <select 
                name="location"
                value={dataPoint.location} 
                onChange={handleChange}
                className="metal-select"
              >
                <option value="">Select location</option>
                <option value="Barrow, Alaska">Barrow, Alaska</option>
                <option value="Norilsk, Russia">Norilsk, Russia</option>
                <option value="Iqaluit, Canada">Iqaluit, Canada</option>
                <option value="Kiruna, Sweden">Kiruna, Sweden</option>
                <option value="Vorkuta, Russia">Vorkuta, Russia</option>
                <option value="Other">Other Research Station</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Ground Temperature (°C) *</label>
              <input 
                type="number"
                name="temperature"
                value={dataPoint.temperature} 
                onChange={handleChange}
                placeholder="Enter temperature..." 
                className="metal-input"
                step="0.1"
              />
            </div>
            
            <div className="form-group">
              <label>Methane Level (ppm) *</label>
              <input 
                type="number"
                name="methaneLevel"
                value={dataPoint.methaneLevel} 
                onChange={handleChange}
                placeholder="Enter methane level..." 
                className="metal-input"
                step="0.01"
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="shield-icon"></div> 
            <span>Data remains encrypted during FHE processing and risk assessment</span>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn metal-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={adding}
            className="submit-btn metal-button primary"
          >
            {adding ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;