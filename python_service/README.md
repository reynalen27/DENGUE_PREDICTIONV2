# Python Model Service

This service runs machine learning models for dengue prediction and stores forecasts in the database.

## Setup

1. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Configure environment:
```bash
cp .env.example .env
# Edit .env with your database credentials
```

## Running the Service

To run forecasts for all regions:
```bash
python main.py
```

## Models

- **Hybrid Model**: Bayesian-neural hybrid combining LSTM with Bayesian credible intervals
- **SARIMA Baseline**: Seasonal ARIMA baseline model
- **LSTM Baseline**: Simple LSTM-based baseline model

## Output

- Predictions are stored in the `predictions` table
- Evaluation metrics are stored in the `evaluation_metrics` table
- Logs are written to `model_service.log`

## Database Requirements

The following tables must exist:
- `regions` - Region definitions
- `cases` - Historical case data
- `predictions` - Store for model predictions
- `evaluation_metrics` - Store for evaluation metrics
