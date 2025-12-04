// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PermafrostRiskFHE is SepoliaConfig {
    struct EncryptedMeasurement {
        uint256 id;
        euint32 encryptedTemperature;
        euint32 encryptedGasLevel;
        uint256 timestamp;
    }

    struct DecryptedMeasurement {
        int32 temperature;
        int32 gasLevel;
        bool isDecrypted;
    }

    uint256 public measurementCount;
    mapping(uint256 => EncryptedMeasurement) public encryptedMeasurements;
    mapping(uint256 => DecryptedMeasurement) public decryptedMeasurements;

    mapping(string => euint32) private encryptedZoneRisk;
    string[] private zoneList;

    mapping(uint256 => uint256) private requestToMeasurementId;

    event MeasurementSubmitted(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event MeasurementDecrypted(uint256 indexed id);

    modifier onlyResearcher(uint256 measurementId) {
        _;
    }

    function submitEncryptedMeasurement(
        euint32 encryptedTemperature,
        euint32 encryptedGasLevel
    ) public {
        measurementCount += 1;
        uint256 newId = measurementCount;

        encryptedMeasurements[newId] = EncryptedMeasurement({
            id: newId,
            encryptedTemperature: encryptedTemperature,
            encryptedGasLevel: encryptedGasLevel,
            timestamp: block.timestamp
        });

        decryptedMeasurements[newId] = DecryptedMeasurement({
            temperature: 0,
            gasLevel: 0,
            isDecrypted: false
        });

        emit MeasurementSubmitted(newId, block.timestamp);
    }

    function requestMeasurementDecryption(uint256 measurementId) public onlyResearcher(measurementId) {
        EncryptedMeasurement storage measurement = encryptedMeasurements[measurementId];
        require(!decryptedMeasurements[measurementId].isDecrypted, "Already decrypted");

        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(measurement.encryptedTemperature);
        ciphertexts[1] = FHE.toBytes32(measurement.encryptedGasLevel);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptMeasurement.selector);
        requestToMeasurementId[reqId] = measurementId;

        emit DecryptionRequested(measurementId);
    }

    function decryptMeasurement(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 measurementId = requestToMeasurementId[requestId];
        require(measurementId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        int32[] memory results = abi.decode(cleartexts, (int32[]));
        DecryptedMeasurement storage dMeasurement = decryptedMeasurements[measurementId];

        dMeasurement.temperature = results[0];
        dMeasurement.gasLevel = results[1];
        dMeasurement.isDecrypted = true;

        string memory zone = assignZone(dMeasurement.temperature, dMeasurement.gasLevel);

        if (!FHE.isInitialized(encryptedZoneRisk[zone])) {
            encryptedZoneRisk[zone] = FHE.asEuint32(0);
            zoneList.push(zone);
        }

        encryptedZoneRisk[zone] = FHE.add(encryptedZoneRisk[zone], FHE.asEuint32(1));

        emit MeasurementDecrypted(measurementId);
    }

    function getDecryptedMeasurement(uint256 measurementId) public view returns (
        int32 temperature,
        int32 gasLevel,
        bool isDecrypted
    ) {
        DecryptedMeasurement storage m = decryptedMeasurements[measurementId];
        return (m.temperature, m.gasLevel, m.isDecrypted);
    }

    function getEncryptedZoneRisk(string memory zone) public view returns (euint32) {
        return encryptedZoneRisk[zone];
    }

    function requestZoneRiskDecryption(string memory zone) public {
        euint32 risk = encryptedZoneRisk[zone];
        require(FHE.isInitialized(risk), "Zone not found");

        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(risk);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptZoneRisk.selector);
        requestToMeasurementId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(zone)));
    }

    function decryptZoneRisk(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 zoneHash = requestToMeasurementId[requestId];
        string memory zone = getZoneFromHash(zoneHash);

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32 riskValue = abi.decode(cleartexts, (uint32));
    }

    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }

    function getZoneFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < zoneList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(zoneList[i]))) == hash) {
                return zoneList[i];
            }
        }
        revert("Zone not found");
    }

    function assignZone(int32 temperature, int32 gasLevel) private pure returns (string memory) {
        if (temperature < -2) return "LowRisk";
        else if (temperature < 2) return "MediumRisk";
        else return "HighRisk";
    }
}