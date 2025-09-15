// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockWeatherOracle {
    int256 public latestWeather;
    uint80 public latestRound;

    constructor(int256 _initialWeather) {
        latestWeather = _initialWeather;
        latestRound = 1;
    }

    function updatePrice(int256 _newWeather) external {
        latestWeather = _newWeather;
        latestRound += 1;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (
            latestRound,
            latestWeather,
            block.timestamp,
            block.timestamp,
            latestRound
        );
    }
}
