import torch
import torch.nn as nn
from TCN.tcn import TemporalConvNet

class TCN_LSTM(nn.Module):
    def __init__(self, input_channels, num_channels, kernel_size, dropout, lstm_hidden, lstm_layers, embedding_dim, use_weight_norm=True):
        super(TCN_LSTM, self).__init__()
        self.tcn = TemporalConvNet(num_inputs=input_channels,
                                   num_channels=num_channels,
                                   kernel_size=kernel_size,
                                   dropout=dropout,
                                   use_weight_norm=use_weight_norm)
        self.lstm = nn.LSTM(input_size=num_channels[-1],
                            hidden_size=lstm_hidden,
                            num_layers=lstm_layers,
                            batch_first=True)
        self.linear = nn.Linear(lstm_hidden, embedding_dim)
        self.dropout = nn.Dropout(dropout)

        self.linear.weight.data.normal_(0, 0.005)
        self.linear.bias.data.fill_(0)

    def forward(self, x):
        y = self.tcn(x)
        y = y.transpose(1, 2)
        y, _ = self.lstm(y)
        y = self.dropout(y[:, -1, :])
        out = self.linear(y)
        return out
